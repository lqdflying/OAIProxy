import { createHash } from "crypto";

import type { ResponsesInputItem } from "./openaiResponsesApi";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

export interface OpenAIResponsesStateIdentity {
	readonly normalizedBaseUrl: string;
	readonly modelId: string;
	readonly modelInfoId: string;
	readonly configId?: string;
	readonly requestInitiator?: string;
	readonly instructions?: unknown;
	readonly tools?: unknown;
	readonly toolChoice?: unknown;
}

export interface OpenAIResponsesStateEntry {
	readonly responseId: string;
	readonly inputSignatures: readonly string[];
	readonly updatedAt: number;
}

export interface OpenAIResponsesStateResolution {
	readonly stateKey: string;
	readonly inputSignatures: readonly string[];
	readonly responseId?: string;
	readonly deltaInput: ResponsesInputItem[] | null;
	readonly memoryStateFound: boolean;
	readonly memoryStateExpired: boolean;
	readonly memoryPrefixMatched: boolean;
	readonly previousInputCount?: number;
	readonly currentInputCount: number;
	readonly memoryDeltaInputCount?: number;
	readonly memorySkippedAssistantInputCount?: number;
}

export class OpenAIResponsesStateStore {
	private readonly _entries = new Map<string, OpenAIResponsesStateEntry>();
	private readonly _ttlMs: number;
	private readonly _maxEntries: number;

	constructor(options?: { readonly ttlMs?: number; readonly maxEntries?: number }) {
		this._ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
		this._maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
	}

	get size(): number {
		return this._entries.size;
	}

	resolve(options: {
		readonly identity: OpenAIResponsesStateIdentity;
		readonly fullInput: readonly ResponsesInputItem[];
		readonly now?: number;
		readonly previousResponseIdUnsupported?: boolean;
	}): OpenAIResponsesStateResolution {
		const now = options.now ?? Date.now();
		this.prune(now);

		const inputSignatures = createOpenAIResponsesInputSignatures(options.fullInput);
		const stateKey = buildOpenAIResponsesStateKey(options.identity, inputSignatures);
		const currentInputCount = inputSignatures.length;
		const existing = this._entries.get(stateKey);
		if (!existing) {
			return {
				stateKey,
				inputSignatures,
				deltaInput: null,
				memoryStateFound: false,
				memoryStateExpired: false,
				memoryPrefixMatched: false,
				currentInputCount,
			};
		}

		const memoryStateExpired = now - existing.updatedAt > this._ttlMs;
		const previousInputCount = existing.inputSignatures.length;
		if (memoryStateExpired) {
			this._entries.delete(stateKey);
			return {
				stateKey,
				inputSignatures,
				deltaInput: null,
				memoryStateFound: true,
				memoryStateExpired: true,
				memoryPrefixMatched: false,
				previousInputCount,
				currentInputCount,
			};
		}

		const memoryPrefixMatched =
			!options.previousResponseIdUnsupported &&
			previousInputCount > 0 &&
			previousInputCount < inputSignatures.length &&
			hasSignaturePrefix(inputSignatures, existing.inputSignatures);
		if (!memoryPrefixMatched) {
			return {
				stateKey,
				inputSignatures,
				deltaInput: null,
				memoryStateFound: true,
				memoryStateExpired: false,
				memoryPrefixMatched: false,
				previousInputCount,
				currentInputCount,
			};
		}

		const { deltaInput, skippedAssistantInputCount } = sliceOpenAIResponsesDeltaAfterPreviousResponse(
			options.fullInput,
			previousInputCount
		);
		return {
			stateKey,
			inputSignatures,
			responseId: existing.responseId,
			deltaInput,
			memoryStateFound: true,
			memoryStateExpired: false,
			memoryPrefixMatched,
			previousInputCount,
			currentInputCount,
			memoryDeltaInputCount: deltaInput.length,
			memorySkippedAssistantInputCount: skippedAssistantInputCount,
		};
	}

	update(options: {
		readonly stateKey: string;
		readonly responseId: string;
		readonly inputSignatures: readonly string[];
		readonly now?: number;
	}): boolean {
		const responseId = options.responseId.trim();
		if (!responseId || options.inputSignatures.length === 0) {
			return false;
		}

		const now = options.now ?? Date.now();
		this._entries.set(options.stateKey, {
			responseId,
			inputSignatures: [...options.inputSignatures],
			updatedAt: now,
		});
		this.prune(now);
		return true;
	}

	clear(stateKey: string): void {
		this._entries.delete(stateKey);
	}

	private prune(now: number): void {
		for (const [key, entry] of this._entries) {
			if (now - entry.updatedAt > this._ttlMs) {
				this._entries.delete(key);
			}
		}

		while (this._entries.size > this._maxEntries) {
			const oldest = Array.from(this._entries.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
			if (!oldest) {
				return;
			}
			this._entries.delete(oldest[0]);
		}
	}
}

export function createOpenAIResponsesInputSignatures(
	input: readonly ResponsesInputItem[]
): string[] {
	return input.map((item) => hashStableValue(normalizeResponsesInputItemForSignature(item)));
}

function buildOpenAIResponsesStateKey(
	identity: OpenAIResponsesStateIdentity,
	inputSignatures: readonly string[]
): string {
	return hashStableValue({
		normalizedBaseUrl: identity.normalizedBaseUrl,
		modelId: identity.modelId,
		modelInfoId: identity.modelInfoId,
		configId: identity.configId ?? "",
		requestInitiator: identity.requestInitiator ?? "",
		instructions: hashStableValue(identity.instructions ?? null),
		tools: hashStableValue(identity.tools ?? null),
		toolChoice: hashStableValue(identity.toolChoice ?? null),
		conversationAnchor: inputSignatures[0] ?? "",
	});
}

function hasSignaturePrefix(
	currentInputSignatures: readonly string[],
	previousInputSignatures: readonly string[]
): boolean {
	if (previousInputSignatures.length > currentInputSignatures.length) {
		return false;
	}
	for (let i = 0; i < previousInputSignatures.length; i++) {
		if (previousInputSignatures[i] !== currentInputSignatures[i]) {
			return false;
		}
	}
	return true;
}

function sliceOpenAIResponsesDeltaAfterPreviousResponse(
	fullInput: readonly ResponsesInputItem[],
	previousInputCount: number
): { deltaInput: ResponsesInputItem[]; skippedAssistantInputCount: number } {
	let start = previousInputCount;
	let skippedAssistantInputCount = 0;
	while (start < fullInput.length && isAssistantGeneratedResponsesItem(fullInput[start])) {
		start++;
		skippedAssistantInputCount++;
	}

	return {
		deltaInput: fullInput.slice(start),
		skippedAssistantInputCount,
	};
}

function isAssistantGeneratedResponsesItem(item: ResponsesInputItem | undefined): boolean {
	if (!item || typeof item !== "object") {
		return false;
	}
	if (item.type === "reasoning" || item.type === "function_call") {
		return true;
	}
	if (item.type === "message" && "role" in item && item.role === "assistant") {
		return true;
	}
	return false;
}

function normalizeResponsesInputItemForSignature(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeResponsesInputItemForSignature(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (key === "id" || key === "status") {
			continue;
		}
		out[key] = normalizeResponsesInputItemForSignature(item);
	}
	return out;
}

function hashStableValue(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
	if (value === null || value === undefined) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return `{${Object.keys(obj)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

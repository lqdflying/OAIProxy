import * as vscode from "vscode";
import { tokenizerManager } from "./tokenizer/tokenizerManager";
import { readImageSize, type ImageSize } from "./tokenizer/imageUtils";
import {
	getPartOrigin,
	isImageDataPart,
	isPromptMetadata,
	isToolResultContent,
	prepareMessagesForApi,
} from "./messageContent";
import { getLanguageModelThinkingText, isLanguageModelThinkingPart } from "./vscodeCompat";
import { DEFAULT_TOKEN_ESTIMATION, fallbackTextTokenLength, type EstimationContext, type ImageTokenConfig } from "./tokenEstimationConfig";
import { logger } from "./logger";

export const BaseTokensPerMessage = 3;
export const BaseTokensPerName = 1;
export interface TokenContributor {
	messageIndex?: number;
	partIndex: number;
	callId?: string;
	type: string;
	mime?: string;
	bytes?: number;
	tokens: number;
	profile?: string;
	confidence?: "documented" | "heuristic";
}
export interface MessageTokenDetails {
	totalTokens: number;
	overheadTokens: number;
	textTokens: number;
	imageTokens: number;
	binaryTokens: number;
	toolCallTokens: number;
	toolResultTokens: number;
	reasoningTokens: number;
	parts?: TokenContributor[];
}

export function emptyMessageTokenDetails(): MessageTokenDetails {
	return {
		totalTokens: 0,
		overheadTokens: 0,
		textTokens: 0,
		imageTokens: 0,
		binaryTokens: 0,
		toolCallTokens: 0,
		toolResultTokens: 0,
		reasoningTokens: 0,
		parts: [],
	};
}

export function sumMessageTokenDetails(details: MessageTokenDetails): number {
	return (
		details.overheadTokens +
		details.textTokens +
		details.imageTokens +
		details.binaryTokens +
		details.toolCallTokens +
		details.toolResultTokens +
		details.reasoningTokens
	);
}

export async function textTokenLength(text: string, context?: EstimationContext): Promise<number> {
	let tokens: number;
	try {
		tokens = await tokenizerManager.countTokens(text);
	} catch {
		tokens = fallbackTextTokenLength(text, context?.settings);
		logger.debug("tokenizer.fallback", { textLength: text.length });
	}
	return Math.ceil(tokens * Math.max(1, Math.min(2, context?.textMultiplier ?? 1)));
}

function fit(size: ImageSize, longEdge: number): ImageSize {
	const scale = Math.min(1, longEdge / Math.max(size.width, size.height));
	return { width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)) };
}

function patchCount(size: ImageSize, patch: number): number {
	return Math.ceil(size.width / patch) * Math.ceil(size.height / patch);
}

function fitPatches(size: ImageSize, patch: number, budget: number): ImageSize {
	if (patchCount(size, patch) <= budget) {
		return size;
	}
	// Find the largest aspect-preserving integer dimensions within the patch budget.
	let low = 0;
	let high = 1;
	for (let i = 0; i < 48; i++) {
		const scale = (low + high) / 2;
		const candidate = {
			width: Math.max(1, Math.floor(size.width * scale)),
			height: Math.max(1, Math.floor(size.height * scale)),
		};
		if (patchCount(candidate, patch) <= budget) {
			low = scale;
		} else {
			high = scale;
		}
	}
	return { width: Math.max(1, Math.floor(size.width * low)), height: Math.max(1, Math.floor(size.height * low)) };
}

function fitOpenAIPatches(size: ImageSize, budget: number): ImageSize {
	if (patchCount(size, 32) <= budget) {
		return size;
	}
	const scale = Math.sqrt((32 * 32 * budget) / (size.width * size.height));
	const horizontal = (size.width * scale) / 32;
	const vertical = (size.height * scale) / 32;
	const correction = Math.min(Math.floor(horizontal) / horizontal, Math.floor(vertical) / vertical);
	if (correction <= 0) {
		return fitPatches(size, 32, budget);
	}
	const adjusted = {
		width: Math.max(1, Math.floor(size.width * scale * correction)),
		height: Math.max(1, Math.floor(size.height * scale * correction)),
	};
	return fitPatches(adjusted, 32, budget);
}

/** Profiles are documented in doc/token-estimation.md; unknown aliases never inherit a vendor rule. */
export function estimateImageTokens(
	size: ImageSize | undefined,
	config: ImageTokenConfig,
	modelId = "",
	detail = "auto"
): { tokens: number; profile: string; confidence: "documented" | "heuristic" } {
	const model = modelId.split("::")[0].toLowerCase();
	let profile: string = config.profile;
	if (profile === "auto") {
		profile = /^(gpt-6-astra|gpt-5\.[2456](?:-|$)|gpt-4\.1-mini)/.test(model)
			? "openai-patches"
			: /^(gpt-4o(?:-|$)|gpt-4\.1(?:-|$)|gpt-5\.1(?:-|$))/.test(model)
				? "openai-tiles"
				: /^claude-(?:(?:opus|sonnet|haiku)-(?:4|5)(?:-|$)|3(?:-|\.))/.test(model)
					? /claude-(?:opus|sonnet|haiku)-(?:[5-9]|4-[7-9])/.test(model)
						? "claude-high"
						: "claude-standard"
					: "unknown";
	}
	const heuristic = (tokens: number, name: string) => ({ tokens, profile: name, confidence: "heuristic" as const });
	if (config.strategy === "fixed") {
		return heuristic(config.fixedTokens, "fixed");
	}
	if (!size) {
		return heuristic(config.fallbackTokens, "unreadable-header");
	}
	if (config.strategy === "area") {
		const resized = fit(size, config.maxLongEdge);
		return heuristic(
			Math.min(config.maxTokensPerImage, Math.ceil((resized.width * resized.height) / config.areaDivisor)),
			"area"
		);
	}
	let tokens: number;
	if (profile === "openai-patches") {
		const original = detail === "original" || (detail === "auto" && /^(gpt-6-astra|gpt-5\.[56])/.test(model));
		const astra = model.startsWith("gpt-6-astra");
		const modern = astra || model.startsWith("gpt-5.6");
		let resized = fit(
			size,
			original && modern ? 65535 : original ? 6000 : modern && detail === "low" ? 512 : astra ? 65535 : 2048
		);
		if (!(original && modern) && !(modern && detail === "low")) {
			const budget = original
				? 10000
				: /^(gpt-5\.2|gpt-4\.1-mini)/.test(model) || (model.startsWith("gpt-5.4") && detail === "low")
					? 6144
					: 2500;
			resized = fitOpenAIPatches(resized, budget);
		}
		tokens = Math.ceil(patchCount(resized, 32) * (model.startsWith("gpt-4.1-mini") ? 1.62 : 1.2));
	} else if (profile === "openai-tiles") {
		const base = model.startsWith("gpt-4o-mini") ? 2833 : model.startsWith("gpt-5.1") ? 70 : 85;
		const perTile = model.startsWith("gpt-4o-mini") ? 5667 : model.startsWith("gpt-5.1") ? 140 : 170;
		let resized = fit(size, 2048);
		if (Math.min(resized.width, resized.height) > 768) {
			const scale = 768 / Math.min(resized.width, resized.height);
			resized = { width: Math.floor(resized.width * scale), height: Math.floor(resized.height * scale) };
		}
		tokens = detail === "low" ? base : base + patchCount(resized, 512) * perTile;
	} else if (profile === "claude-standard" || profile === "claude-high") {
		const high = profile === "claude-high";
		tokens = patchCount(fitPatches(fit(size, high ? 2576 : 1568), 28, high ? 4784 : 1568), 28);
	} else {
		return heuristic(config.fallbackTokens, "unknown-model");
	}
	return { tokens, profile, confidence: "documented" };
}

export async function countMessageTokenDetails(
	input: string | vscode.LanguageModelChatRequestMessage,
	context: EstimationContext
): Promise<MessageTokenDetails> {
	const details = emptyMessageTokenDetails();
	if (typeof input === "string") {
		details.textTokens = await textTokenLength(input, context);
		details.totalTokens = details.textTokens;
		return details;
	}
	const messages = prepareMessagesForApi([input], context);
	const settings = context.settings ?? DEFAULT_TOKEN_ESTIMATION;
	for (const message of messages) {
		const meaningful = message.content.filter((part) => !isPromptMetadata(part));
		if (meaningful.length === 0) {
			continue;
		}
		details.overheadTokens += BaseTokensPerMessage + BaseTokensPerName;
		const walk = async (parts: readonly unknown[], callId?: string): Promise<void> => {
			for (const [partIndex, part] of parts.entries()) {
				const contribution: TokenContributor = {
					partIndex,
					...getPartOrigin(part),
					...(callId ? { callId } : {}),
					type: "text",
					tokens: 0,
				};
				if (part instanceof vscode.LanguageModelTextPart) {
					contribution.tokens = await textTokenLength(part.value, context);
					contribution.type = callId ? "tool-result" : "text";
					details[callId ? "toolResultTokens" : "textTokens"] += contribution.tokens;
				} else if (isImageDataPart(part)) {
					const cached = context.imageMode === "bridge" ? context.cachedDescription?.(part) : undefined;
					const estimate =
						context.imageMode === "bridge"
							? {
									tokens: cached === undefined ? settings.bridgeTokens : await textTokenLength(cached, context),
									profile: cached === undefined ? "bridge-provisional" : "bridge-cached",
									confidence: "heuristic" as const,
								}
							: estimateImageTokens(readImageSize(part.data, part.mimeType), settings.image, context.modelId);
					Object.assign(contribution, estimate, { type: "image", mime: part.mimeType, bytes: part.data.byteLength });
					details.imageTokens += estimate.tokens;
				} else if (isToolResultContent(part)) {
					await walk(part.content, part.callId);
					continue;
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					contribution.type = "tool-call";
					contribution.callId = part.callId;
					contribution.tokens =
						BaseTokensPerName +
						(await textTokenLength(part.name, context)) +
						(await textTokenLength(JSON.stringify(part.input ?? {}), context));
					details.toolCallTokens += contribution.tokens;
				} else if (isLanguageModelThinkingPart(part) && context.includeReasoningInRequest) {
					contribution.type = "reasoning";
					contribution.tokens = await textTokenLength(getLanguageModelThinkingText(part), context);
					details.reasoningTokens += contribution.tokens;
				} else if (part instanceof vscode.LanguageModelDataPart && !isPromptMetadata(part)) {
					Object.assign(contribution, {
						type: "video",
						mime: part.mimeType,
						bytes: part.data.byteLength,
						tokens: settings.image.fallbackTokens,
						confidence: "heuristic",
					});
					details.binaryTokens += contribution.tokens;
				}
				if (contribution.tokens > 0) {
					details.parts!.push(contribution);
				}
			}
		};
		await walk(meaningful);
	}
	details.totalTokens = sumMessageTokenDetails(details);
	return details;
}

export async function countMessageTokens(
	input: string | vscode.LanguageModelChatRequestMessage,
	context: EstimationContext
): Promise<number> {
	if (typeof input === "string") {
		return textTokenLength(input, context);
	}
	return (await countMessageTokenDetails(input, context)).totalTokens;
}

export async function countToolTokens(
	tools: readonly vscode.LanguageModelChatTool[],
	context?: EstimationContext
): Promise<number> {
	let tokens = tools.length ? 16 : 0;
	for (const tool of tools) {
		tokens +=
			8 +
			(await textTokenLength(
				JSON.stringify({
					name: tool.name,
					description: tool.description ?? "",
					parameters: tool.inputSchema ?? { type: "object", properties: {} },
				}),
				context
			));
	}
	return tokens;
}

export interface PreparedEstimate {
	details: MessageTokenDetails;
	toolDefinitionTokens: number;
	textCategories: { systemContext: number; currentPrompt: number; conversationHistory: number };
}

/** Count semantic wire content, never base64 strings, request controls, IDs, or usage metadata. */
export async function estimatePreparedRequest(body: unknown, context: EstimationContext): Promise<PreparedEstimate> {
	const details = emptyMessageTokenDetails();
	const root = body as Record<string, unknown>;
	const settings = context.settings ?? DEFAULT_TOKEN_ESTIMATION;
	const imageOccurrences = new Map<string, number>();
	let partIndex = 0;
	let messageIndex = 0;
	let textCategory: "systemContext" | "currentPrompt" | "conversationHistory" = "conversationHistory";
	const textCategories = { systemContext: 0, currentPrompt: 0, conversationHistory: 0 };
	const text = async (
		value: unknown,
		kind: "textTokens" | "toolCallTokens" | "toolResultTokens" | "reasoningTokens",
		callId?: string
	) => {
		if (typeof value !== "string" || !value) {
			return;
		}
		const tokens = await textTokenLength(value, context);
		details[kind] += tokens;
		if (kind === "textTokens") {
			textCategories[textCategory] += tokens;
		}
		details.parts!.push({
			messageIndex,
			partIndex: partIndex++,
			callId,
			type:
				kind === "toolResultTokens"
					? "tool-result"
					: kind === "toolCallTokens"
						? "tool-call"
						: kind === "reasoningTokens"
							? "reasoning"
							: "text",
			tokens,
		});
	};
	const image = (data: unknown, mime: string, detail = "auto", callId?: string) => {
		let size: ImageSize | undefined;
		let bytes: number | undefined;
		let origin: ReturnType<typeof getPartOrigin>;
		if (typeof data === "string") {
			const comma = data.indexOf(",");
			const encoded = data.startsWith("data:") ? data.slice(comma + 1) : data;
			const dataMime = data.startsWith("data:") ? data.slice(5, data.indexOf(";")) : mime;
			const occurrence = imageOccurrences.get(encoded) ?? 0;
			imageOccurrences.set(encoded, occurrence + 1);
			const sources = context.imageSources?.get(encoded);
			const source = sources?.[occurrence];
			if (source) {
				size = readImageSize(source.data, source.mimeType);
				bytes = source.data.byteLength;
				mime = source.mimeType;
				origin = getPartOrigin(source);
			} else if (!/^https?:/.test(encoded)) {
				mime = dataMime;
				// JPEG headers can contain metadata before SOF; keep this read bounded.
				size = readImageSize(Buffer.from(encoded.slice(0, 349528), "base64"), dataMime);
				bytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
			}
		}
		const estimate = estimateImageTokens(size, settings.image, context.modelId, detail);
		details.imageTokens += estimate.tokens;
		details.parts!.push({
			messageIndex,
			partIndex: partIndex++,
			callId,
			type: "image",
			mime,
			bytes,
			...origin,
			...estimate,
		});
	};
	const walk = async (
		value: unknown,
		kind: "textTokens" | "toolResultTokens" | "reasoningTokens" = "textTokens",
		callId?: string
	): Promise<void> => {
		if (typeof value === "string") {
			await text(value, kind, callId);
			return;
		}
		if (Array.isArray(value)) {
			for (const part of value) {
				await walk(part, kind, callId);
			}
			return;
		}
		if (!value || typeof value !== "object") {
			return;
		}
		const item = value as Record<string, unknown>;
		const source = item.source as Record<string, unknown> | undefined;
		const inline = item.inlineData as Record<string, unknown> | undefined;
		if (item.type === "image" || item.type === "input_image" || item.type === "image_url" || inline) {
			const url = item.image_url;
			const imageUrl = url && typeof url === "object" ? (url as Record<string, unknown>) : undefined;
			image(
				source?.data ?? inline?.data ?? imageUrl?.url ?? url,
				String(source?.media_type ?? inline?.mimeType ?? "image/unknown"),
				String(imageUrl?.detail ?? item.detail ?? "auto"),
				callId
			);
			return;
		}
		if (item.type === "video" || item.type === "video_url") {
			details.binaryTokens += settings.image.fallbackTokens;
			details.parts!.push({
				partIndex: partIndex++,
				type: "video",
				tokens: settings.image.fallbackTokens,
				confidence: "heuristic",
			});
			return;
		}
		const fn = (item.function ?? item.functionCall) as Record<string, unknown> | undefined;
		if (item.type === "function_call" || item.type === "tool_use" || fn) {
			await text(fn?.name ?? item.name, "toolCallTokens", String(item.call_id ?? item.id ?? ""));
			const args = fn?.arguments ?? fn?.args ?? item.arguments ?? item.input ?? {};
			await text(typeof args === "string" ? args : JSON.stringify(args), "toolCallTokens");
			details.toolCallTokens += BaseTokensPerName;
			return;
		}
		if (item.functionResponse && typeof item.functionResponse === "object") {
			const response = item.functionResponse as Record<string, unknown>;
			await text(JSON.stringify(response.response ?? {}), "toolResultTokens", String(response.name ?? ""));
			return;
		}
		const toolResult = item.type === "function_call_output" || item.type === "tool_result" || item.role === "tool";
		const nextKind = toolResult
			? "toolResultTokens"
			: item.type === "reasoning" || item.type === "thinking"
				? "reasoningTokens"
				: kind;
		const id = String(item.call_id ?? item.tool_use_id ?? item.tool_call_id ?? callId ?? "") || undefined;
		await text(item.text, nextKind, id);
		await text(item.reasoning_content ?? item.thinking, "reasoningTokens", id);
		for (const key of ["content", "parts", "output", "summary", "tool_calls"]) {
			if (item[key] !== undefined) {
				await walk(item[key], nextKind, id);
			}
		}
		if (Array.isArray(item.images)) {
			for (const encoded of item.images) {
				// Ollama images do not carry MIME. Sniff supported signatures.
				const prefix = String(encoded).slice(0, 16);
				image(
					encoded,
					prefix.startsWith("iVBOR")
						? "image/png"
						: prefix.startsWith("/9j/")
							? "image/jpeg"
							: prefix.startsWith("R0lGOD")
								? "image/gif"
								: "image/webp",
					"auto",
					id
				);
			}
		}
	};
	for (const key of ["messages", "input", "contents"]) {
		const messages = root[key];
		if (Array.isArray(messages)) {
			const lastUserIndex = messages.findLastIndex(
				(message) => message && typeof message === "object" && message.role === "user"
			);
			for (const [index, message] of messages.entries()) {
				messageIndex = index;
				partIndex = 0;
				textCategory =
					message?.role === "system" || message?.role === "developer"
						? "systemContext"
						: index === lastUserIndex
							? "currentPrompt"
							: "conversationHistory";
				details.overheadTokens += BaseTokensPerMessage + BaseTokensPerName;
				textCategories[textCategory] += BaseTokensPerMessage + BaseTokensPerName;
				await walk(message);
			}
		} else if (typeof messages === "string") {
			textCategory = "currentPrompt";
			await walk(messages);
		}
	}
	for (const key of ["system", "instructions", "systemInstruction"]) {
		if (root[key] !== undefined) {
			textCategory = "systemContext";
			details.overheadTokens += BaseTokensPerMessage + BaseTokensPerName;
			textCategories.systemContext += BaseTokensPerMessage + BaseTokensPerName;
			await walk(root[key]);
		}
	}
	let toolDefinitionTokens = 0;
	if (Array.isArray(root.tools) && root.tools.length) {
		toolDefinitionTokens = 16;
		for (const value of root.tools) {
			const tool = value as Record<string, unknown>;
			const definitions = Array.isArray(tool.functionDeclarations)
				? tool.functionDeclarations
				: [tool.function ?? tool];
			for (const definition of definitions) {
				const def = definition as Record<string, unknown>;
				toolDefinitionTokens +=
					8 +
					(await textTokenLength(
						JSON.stringify({
							name: def.name,
							description: def.description ?? "",
							parameters: def.parameters ?? def.input_schema ?? { type: "object", properties: {} },
						}),
						context
					));
			}
		}
	}
	details.totalTokens = sumMessageTokenDetails(details);
	return { details, toolDefinitionTokens, textCategories };
}

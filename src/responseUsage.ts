import * as vscode from "vscode";

// Copilot 0.60 consumes this data-part MIME to populate its Session Info usage counters.
export const COPILOT_USAGE_MIME = "usage";

export type ResponseUsageSource = "openai" | "openai-responses" | "anthropic" | "gemini" | "ollama";

export interface CopilotResponseUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_tokens_details: {
		cached_tokens: number;
	};
	completion_tokens_details?: {
		reasoning_tokens: number;
	};
	cache_creation_input_tokens?: number;
}

export function isResponseUsagePart(part: unknown): boolean {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME;
}

interface AccumulatedUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cachedTokens?: number;
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
	reasoningTokens?: number;
	thoughtsTokens?: number;
}

export class ResponseUsageAccumulator {
	private readonly _usage: AccumulatedUsage = {};

	constructor(private readonly _source: ResponseUsageSource) {}

	record(payload: unknown): void {
		const root = asObject(payload);
		if (!root) {
			return;
		}

		switch (this._source) {
			case "openai":
				this.recordOpenAIUsage(asObject(root.usage));
				break;
			case "openai-responses": {
				const response = asObject(root.response);
				this.recordOpenAIUsage(response ? asObject(response.usage) : null);
				break;
			}
			case "anthropic": {
				const message = asObject(root.message);
				if (message) {
					this.recordAnthropicUsage(asObject(message.usage));
				}
				this.recordAnthropicUsage(asObject(root.usage));
				break;
			}
			case "gemini":
				this.recordGeminiUsage(asObject(root.usageMetadata) ?? asObject(root.usage_metadata));
				break;
			case "ollama":
				assignCount(this._usage, "inputTokens", root.prompt_eval_count);
				assignCount(this._usage, "outputTokens", root.eval_count);
				break;
		}
	}

	toUsage(): CopilotResponseUsage | null {
		const promptTokens = this.getPromptTokens();
		if (promptTokens === undefined) {
			return null;
		}

		const completionTokens =
			(this._usage.outputTokens ?? 0) +
			(this._source === "gemini" ? (this._usage.thoughtsTokens ?? 0) : 0);
		const totalTokens = this._source === "anthropic"
			? promptTokens + completionTokens
			: this._usage.totalTokens ?? promptTokens + completionTokens;
		const cachedTokens = this._source === "anthropic"
			? this._usage.cacheReadInputTokens ?? 0
			: this._usage.cachedTokens ?? 0;

		const usage: CopilotResponseUsage = {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: totalTokens,
			prompt_tokens_details: {
				cached_tokens: cachedTokens,
			},
		};
		if (this._usage.reasoningTokens !== undefined) {
			usage.completion_tokens_details = {
				reasoning_tokens: this._usage.reasoningTokens,
			};
		}
		if (this._usage.cacheCreationInputTokens !== undefined) {
			usage.cache_creation_input_tokens = this._usage.cacheCreationInputTokens;
		}
		return usage;
	}

	toDataPart(): vscode.LanguageModelDataPart | null {
		const usage = this.toUsage();
		if (!usage) {
			return null;
		}
		return new vscode.LanguageModelDataPart(
			new TextEncoder().encode(JSON.stringify(usage)),
			COPILOT_USAGE_MIME
		);
	}

	private recordOpenAIUsage(usage: Record<string, unknown> | null): void {
		if (!usage) {
			return;
		}
		assignFirstCount(this._usage, "inputTokens", usage.prompt_tokens, usage.input_tokens);
		assignFirstCount(this._usage, "outputTokens", usage.completion_tokens, usage.output_tokens);
		assignCount(this._usage, "totalTokens", usage.total_tokens);

		const promptDetails = asObject(usage.prompt_tokens_details) ?? asObject(usage.input_tokens_details);
		if (promptDetails) {
			assignCount(this._usage, "cachedTokens", promptDetails.cached_tokens);
		}
		assignCount(this._usage, "cachedTokens", usage.cached_tokens);

		// DeepSeek reports prompt-cache usage through dedicated fields instead of
		// `prompt_tokens_details.cached_tokens`, and its documented example leaves
		// the generic field present as zero.
		const cacheHit = readCount(usage.prompt_cache_hit_tokens);
		if (cacheHit !== undefined && (this._usage.cachedTokens === undefined || this._usage.cachedTokens === 0)) {
			this._usage.cachedTokens = cacheHit;
		} else if (this._usage.cachedTokens === undefined) {
			const cacheMiss = readCount(usage.prompt_cache_miss_tokens);
			if (cacheMiss !== undefined && this._usage.inputTokens !== undefined && cacheMiss <= this._usage.inputTokens) {
				this._usage.cachedTokens = this._usage.inputTokens - cacheMiss;
			}
		}

		const completionDetails =
			asObject(usage.completion_tokens_details) ?? asObject(usage.output_tokens_details);
		if (completionDetails) {
			assignCount(this._usage, "reasoningTokens", completionDetails.reasoning_tokens);
		}
	}

	private recordAnthropicUsage(usage: Record<string, unknown> | null): void {
		if (!usage) {
			return;
		}
		assignCount(this._usage, "inputTokens", usage.input_tokens);
		assignCount(this._usage, "outputTokens", usage.output_tokens);
		assignCount(this._usage, "cacheReadInputTokens", usage.cache_read_input_tokens);
		assignCount(this._usage, "cacheCreationInputTokens", usage.cache_creation_input_tokens);
	}

	private recordGeminiUsage(usage: Record<string, unknown> | null): void {
		if (!usage) {
			return;
		}
		assignFirstCount(this._usage, "inputTokens", usage.promptTokenCount, usage.prompt_token_count);
		assignFirstCount(this._usage, "outputTokens", usage.candidatesTokenCount, usage.candidates_token_count);
		assignFirstCount(this._usage, "totalTokens", usage.totalTokenCount, usage.total_token_count);
		assignFirstCount(
			this._usage,
			"cachedTokens",
			usage.cachedContentTokenCount,
			usage.cached_content_token_count
		);
		// Gemini's `candidatesTokenCount` excludes thinking tokens while
		// `totalTokenCount` includes them. Report thinking as part of completion so
		// prompt + completion stays consistent with the reported total.
		const thoughtsTokens = readCount(usage.thoughtsTokenCount) ?? readCount(usage.thoughts_token_count);
		if (thoughtsTokens !== undefined) {
			assignCount(this._usage, "thoughtsTokens", thoughtsTokens);
			if (this._usage.reasoningTokens === undefined) {
				this._usage.reasoningTokens = thoughtsTokens;
			}
		}
	}

	private getPromptTokens(): number | undefined {
		if (this._source !== "anthropic") {
			return this._usage.inputTokens;
		}

		const fields = [
			this._usage.inputTokens,
			this._usage.cacheReadInputTokens,
			this._usage.cacheCreationInputTokens,
		];
		if (fields.every((value) => value === undefined)) {
			return undefined;
		}
		return fields.reduce<number>((total, value) => total + (value ?? 0), 0);
	}
}

function assignFirstCount<K extends keyof AccumulatedUsage>(
	target: AccumulatedUsage,
	key: K,
	...values: unknown[]
): void {
	for (const value of values) {
		if (assignCount(target, key, value)) {
			return;
		}
	}
}

function assignCount<K extends keyof AccumulatedUsage>(
	target: AccumulatedUsage,
	key: K,
	value: unknown
): boolean {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return false;
	}
	target[key] = Math.trunc(value);
	return true;
}

function readCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

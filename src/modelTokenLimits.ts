const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;
const MODEL_PICKER_MILLION_TOKENS = 1000000;
const MODEL_PICKER_NEAR_MILLION_MARGIN = 0.1;

interface TokenLimitSource {
	context_length?: number;
	max_input_tokens?: number;
	max_tokens?: number;
	max_completion_tokens?: number;
}

export interface ModelTokenLimits {
	contextLength: number;
	advertisedContextLength: number;
	maxInputTokens: number;
	maxOutputTokens: number;
}

export function resolveModelTokenLimits(model: TokenLimitSource | null | undefined): ModelTokenLimits {
	const contextLength = model?.context_length ?? DEFAULT_CONTEXT_LENGTH;
	const advertisedContextLength = normalizeModelPickerContextLength(contextLength);
	const maxOutputTokens = model?.max_completion_tokens ?? model?.max_tokens ?? DEFAULT_MAX_TOKENS;
	const defaultMaxInputTokens = Math.max(1, advertisedContextLength - maxOutputTokens);
	const configuredMaxInputTokens = model?.max_input_tokens;
	const maxInputTokens = configuredMaxInputTokens !== undefined
		? Math.max(1, Math.min(configuredMaxInputTokens, defaultMaxInputTokens))
		: defaultMaxInputTokens;

	return {
		contextLength,
		advertisedContextLength,
		maxInputTokens,
		maxOutputTokens,
	};
}

export function normalizeModelPickerContextLength(contextLength: number): number {
	if (!Number.isFinite(contextLength) || contextLength <= MODEL_PICKER_MILLION_TOKENS) {
		return contextLength;
	}

	// Copilot's model picker rounds near-million decimal totals upward, so 1048576 can appear as 2M.
	const lowerMillion = Math.floor(contextLength / MODEL_PICKER_MILLION_TOKENS) * MODEL_PICKER_MILLION_TOKENS;
	if (lowerMillion < MODEL_PICKER_MILLION_TOKENS) {
		return contextLength;
	}

	const margin = lowerMillion * MODEL_PICKER_NEAR_MILLION_MARGIN;
	if (contextLength - lowerMillion <= margin) {
		return lowerMillion;
	}

	return contextLength;
}

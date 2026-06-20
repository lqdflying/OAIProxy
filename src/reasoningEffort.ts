import type { HFModelItem } from "./types";

export const DEFAULT_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const DEEPSEEK_REASONING_EFFORTS = ["high", "max"];
const FIREWORKS_GLM_5_2_REASONING_EFFORTS = ["none", "high", "max"];
const ANTHROPIC_REASONING_EFFORTS = ["low", "medium", "high", "max"];
const ANTHROPIC_OPUS_4_7_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function getRequestedReasoningEffort(
	modelConfiguration: Readonly<Record<string, unknown>> | undefined,
	modelOptions: Readonly<Record<string, unknown>> | undefined
): string | undefined {
	return (
		getStringValue(modelOptions, "reasoningEffort", "reasoning_effort") ??
		getStringValue(modelConfiguration, "reasoningEffort", "reasoning_effort")
	);
}

export function shouldExposeReasoningEffort(model: HFModelItem): boolean {
	return (
		model.supports_reasoning_effort === true ||
		hasReasoningEffortValues(model.supported_reasoning_efforts) ||
		typeof model.default_reasoning_effort === "string" ||
		typeof model.reasoning_effort === "string" ||
		typeof model.reasoning?.effort === "string" ||
		isFireworksGlm52Model(model) ||
		isAnthropicReasoningEffortModel(model)
	);
}

export function getReasoningEfforts(model: HFModelItem, selectedEffort?: string): string[] {
	const appendSelectedAlias = (values: string[]) => {
		const normalizedSelected = selectedEffort?.trim();
		if (
			normalizedSelected &&
			!values.includes(normalizedSelected) &&
			normalizeReasoningEffortForModel(model, normalizedSelected)
		) {
			return [...values, normalizedSelected];
		}
		return values;
	};

	if (hasReasoningEffortValues(model.supported_reasoning_efforts)) {
		return appendSelectedAlias(uniqueReasoningEfforts(model.supported_reasoning_efforts));
	}
	if (isDeepSeekModel(model)) {
		return appendSelectedAlias(DEEPSEEK_REASONING_EFFORTS);
	}
	if (isFireworksGlm52Model(model)) {
		return appendSelectedAlias(FIREWORKS_GLM_5_2_REASONING_EFFORTS);
	}
	if (isAnthropicOpus47Model(model)) {
		return appendSelectedAlias(ANTHROPIC_OPUS_4_7_REASONING_EFFORTS);
	}
	if (isAnthropicReasoningEffortModel(model)) {
		return appendSelectedAlias(ANTHROPIC_REASONING_EFFORTS);
	}
	return DEFAULT_REASONING_EFFORTS;
}

export function getDefaultReasoningEffort(model: HFModelItem, enumValues: string[]): string | undefined {
	const configured = normalizeReasoningEffortForModel(
		model,
		model.default_reasoning_effort ?? model.reasoning_effort ?? model.reasoning?.effort
	);
	if (configured && enumValues.includes(configured)) {
		return configured;
	}
	if (enumValues.length === 0) {
		return undefined;
	}
	if (isAnthropicReasoningEffortModel(model) && enumValues.includes("high")) {
		return "high";
	}
	if (isFireworksGlm52Model(model) && enumValues.includes("max")) {
		return "max";
	}
	if (enumValues.includes("medium")) {
		return "medium";
	}
	return enumValues[0];
}

export function getReasoningEffortDescription(value: string): string {
	switch (value) {
		case "none":
			return "No reasoning applied.";
		case "minimal":
			return "Minimal reasoning for fastest responses.";
		case "low":
			return "Faster responses with less reasoning.";
		case "medium":
			return "Balanced reasoning and speed.";
		case "high":
			return "Greater reasoning depth but slower responses.";
		case "xhigh":
			return "Highest reasoning depth but slowest responses.";
		case "max":
			return "Maximum reasoning capability with no constraints.";
		default:
			return value;
	}
}

export function normalizeReasoningEffortForModel(model: HFModelItem, value: string | undefined): string | undefined {
	const normalized = value?.trim();
	if (!normalized) {
		return undefined;
	}

	if (isDeepSeekModel(model)) {
		if (normalized === "low" || normalized === "medium" || normalized === "high") {
			return "high";
		}
		if (normalized === "xhigh" || normalized === "max") {
			return "max";
		}
		return undefined;
	}

	if (isFireworksGlm52Model(model)) {
		if (normalized === "none") {
			return "none";
		}
		if (normalized === "low" || normalized === "medium" || normalized === "high") {
			return "high";
		}
		if (normalized === "xhigh" || normalized === "max") {
			return "max";
		}
		return undefined;
	}

	if (hasReasoningEffortValues(model.supported_reasoning_efforts)) {
		const values = uniqueReasoningEfforts(model.supported_reasoning_efforts);
		return values.includes(normalized) ? normalized : undefined;
	}

	if (isAnthropicOpus47Model(model)) {
		return ANTHROPIC_OPUS_4_7_REASONING_EFFORTS.includes(normalized) ? normalized : undefined;
	}

	if (isAnthropicReasoningEffortModel(model)) {
		return ANTHROPIC_REASONING_EFFORTS.includes(normalized) ? normalized : undefined;
	}

	return normalized;
}

function hasReasoningEffortValues(value: string[] | undefined): value is string[] {
	return Array.isArray(value) && value.some((item) => item.trim() !== "");
}

function uniqueReasoningEfforts(values: string[]): string[] {
	const normalized = values.map((value) => value.trim()).filter(Boolean);
	return normalized.filter((value, index) => normalized.indexOf(value) === index);
}

function isDeepSeekModel(model: HFModelItem): boolean {
	const id = model.id.toLowerCase();
	const provider = model.owned_by?.toLowerCase() ?? "";
	return id.includes("deepseek") || provider.includes("deepseek");
}

function isFireworksGlm52Model(model: HFModelItem): boolean {
	const id = model.id.toLowerCase();
	const provider = model.owned_by?.toLowerCase() ?? "";
	return id.includes("glm-5p2") && (id.includes("accounts/fireworks/") || provider.includes("fireworks"));
}

function getStringValue(
	values: Readonly<Record<string, unknown>> | undefined,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = values?.[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

export function isAnthropicReasoningEffortModel(model: HFModelItem): boolean {
	const key = getAnthropicModelKey(model);
	return (
		key.includes("claude-mythos-preview") ||
		key.includes("claude-opus-4-7") ||
		key.includes("claude-opus-4-6") ||
		key.includes("claude-sonnet-4-6") ||
		key.includes("claude-opus-4-5")
	);
}

export function isAnthropicAdaptiveThinkingModel(model: HFModelItem): boolean {
	const key = getAnthropicModelKey(model);
	return (
		key.includes("claude-mythos-preview") ||
		key.includes("claude-opus-4-7") ||
		key.includes("claude-opus-4-6") ||
		key.includes("claude-sonnet-4-6")
	);
}

function isAnthropicOpus47Model(model: HFModelItem): boolean {
	const key = getAnthropicModelKey(model);
	return key.includes("claude-opus-4-7");
}

function getAnthropicModelKey(model: HFModelItem): string {
	return [model.id, model.family, model.displayName].filter(Boolean).join(" ").toLowerCase();
}

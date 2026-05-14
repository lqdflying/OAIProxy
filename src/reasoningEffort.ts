import type { HFModelItem } from "./types";

export const DEFAULT_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const DEEPSEEK_REASONING_EFFORTS = ["high", "max"];

export function shouldExposeReasoningEffort(model: HFModelItem): boolean {
	return (
		model.supports_reasoning_effort === true ||
		hasReasoningEffortValues(model.supported_reasoning_efforts) ||
		typeof model.default_reasoning_effort === "string" ||
		typeof model.reasoning_effort === "string" ||
		typeof model.reasoning?.effort === "string"
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
	return undefined;
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

	if (hasReasoningEffortValues(model.supported_reasoning_efforts)) {
		const values = uniqueReasoningEfforts(model.supported_reasoning_efforts);
		return values.includes(normalized) ? normalized : undefined;
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

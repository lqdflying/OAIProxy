import { ProvideLanguageModelChatResponseOptions } from "vscode";

import { OpenaiApi } from "../openai/openaiApi";
import type { HFModelItem, ReasoningConfig } from "../types";
import { convertToolsToOpenAI } from "../utils";

export class LiteLLMApi extends OpenaiApi {
	protected readonly _cacheUsageApiMode = "litellm";

	prepareRequestBody(
		rb: Record<string, unknown>,
		um: HFModelItem | undefined,
		options?: ProvideLanguageModelChatResponseOptions
	): Record<string, unknown> {
		if (um?.temperature !== undefined && um.temperature !== null) {
			rb.temperature = um.temperature;
		}
		if (um?.top_p !== undefined && um.top_p !== null) {
			rb.top_p = um.top_p;
		}
		if (um?.max_completion_tokens !== undefined) {
			rb.max_completion_tokens = um.max_completion_tokens;
		} else if (um?.max_tokens !== undefined) {
			rb.max_tokens = um.max_tokens;
		}
		if (um?.reasoning_effort !== undefined) {
			rb.reasoning_effort = um.reasoning_effort;
		}

		if (options?.modelOptions) {
			const mo = options.modelOptions as Record<string, unknown>;
			if (typeof mo.stop === "string" || Array.isArray(mo.stop)) {
				rb.stop = mo.stop;
			}
		}

		const toolConfig = convertToolsToOpenAI(options);
		if (toolConfig.tools) {
			rb.tools = toolConfig.tools;
		}
		if (toolConfig.tool_choice) {
			rb.tool_choice = toolConfig.tool_choice;
		}

		if (um?.top_k !== undefined) {
			rb.top_k = um.top_k;
		}
		if (um?.min_p !== undefined) {
			rb.min_p = um.min_p;
		}
		if (um?.frequency_penalty !== undefined) {
			rb.frequency_penalty = um.frequency_penalty;
		}
		if (um?.presence_penalty !== undefined) {
			rb.presence_penalty = um.presence_penalty;
		}
		if (um?.repetition_penalty !== undefined) {
			rb.repetition_penalty = um.repetition_penalty;
		}

		const generatedExtraBody = buildLiteLLMExtraBody(um);
		if (um?.extra && typeof um.extra === "object") {
			for (const [key, value] of Object.entries(um.extra)) {
				if (value === undefined) {
					continue;
				}
				if (key === "tools" && Array.isArray(value) && Array.isArray(rb.tools)) {
					rb.tools = [...rb.tools, ...value];
				} else {
					rb[key] = value;
				}
			}
		}

		const extraBody = mergePlainObjects(
			generatedExtraBody,
			isPlainObject(rb.extra_body) ? rb.extra_body as Record<string, unknown> : undefined,
			um?.extra_body
		);
		if (Object.keys(extraBody).length > 0) {
			rb.extra_body = extraBody;
		}

		return rb;
	}
}

export function buildLiteLLMExtraBody(model: HFModelItem | undefined): Record<string, unknown> {
	const extraBody: Record<string, unknown> = {};
	const thinking = buildLiteLLMThinking(model);
	if (thinking) {
		extraBody.thinking = thinking;
	}
	const reasoning = buildLiteLLMReasoning(model?.reasoning);
	if (reasoning) {
		extraBody.reasoning = reasoning;
	}
	return extraBody;
}

function buildLiteLLMThinking(model: HFModelItem | undefined): Record<string, unknown> | undefined {
	let type = model?.thinking?.type;
	if (type === undefined && model?.enable_thinking !== undefined) {
		type = model.enable_thinking ? "enabled" : "disabled";
	}
	if (type === undefined) {
		return undefined;
	}

	const thinking: Record<string, unknown> = { type };
	if (model?.thinking_budget !== undefined) {
		thinking.budget_tokens = model.thinking_budget;
	}
	return thinking;
}

function buildLiteLLMReasoning(reasoning: ReasoningConfig | undefined): Record<string, unknown> | undefined {
	if (reasoning === undefined || reasoning.enabled === false) {
		return undefined;
	}

	const out: Record<string, unknown> = {};
	if (reasoning.effort && reasoning.effort !== "auto") {
		out.effort = reasoning.effort;
	} else if (reasoning.max_tokens !== undefined || reasoning.effort === "auto") {
		out.max_tokens = reasoning.max_tokens ?? 2000;
	}
	if (reasoning.exclude !== undefined) {
		out.exclude = reasoning.exclude;
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

function mergePlainObjects(...objects: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const obj of objects) {
		if (!isPlainObject(obj)) {
			continue;
		}
		for (const [key, value] of Object.entries(obj)) {
			if (value === undefined) {
				continue;
			}
			if (isPlainObject(out[key]) && isPlainObject(value)) {
				out[key] = mergePlainObjects(out[key] as Record<string, unknown>, value as Record<string, unknown>);
			} else {
				out[key] = value;
			}
		}
	}
	return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

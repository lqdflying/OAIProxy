import { ProvideLanguageModelChatResponseOptions } from "vscode";

import { OpenaiApi } from "../openai/openaiApi";
import type { HFModelItem, ReasoningConfig } from "../types";
import { convertToolsToOpenAI } from "../utils";

export class LiteLLMApi extends OpenaiApi {
	constructor(modelId: string) {
		super(modelId, "litellm");
	}

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
		if (usesUpstreamDefaultThinking(um)) {
			// Nube's GLM-5.3 aliases run behind vLLM, where thinking is enabled by
			// the chat template. LiteLLM may promote extra_body.thinking into the
			// upstream request, and named tool calls then fail with an unknown
			// top-level `thinking` field. Keep reasoning_effort, but omit the
			// unsupported explicit thinking controls for both new and saved rows.
			delete rb.thinking;
			delete extraBody.thinking;
		}
		if (usesDeepSeekThinking(um)) {
			preserveDeepSeekReasoningContent(rb, extraBody);
		}
		if (Object.keys(extraBody).length > 0) {
			rb.extra_body = extraBody;
		} else {
			delete rb.extra_body;
		}

		return rb;
	}
}

function usesUpstreamDefaultThinking(model: HFModelItem | undefined): boolean {
	const modelId = model?.id.trim().toLowerCase();
	return modelId === "glm-5.3" || modelId === "glm-5.3-flash";
}

function usesDeepSeekThinking(model: HFModelItem | undefined): boolean {
	const modelId = model?.id.trim().toLowerCase();
	return modelId === "deepseek-v4.1-flash" || modelId === "deepseek-v4-flash";
}

/**
 * DeepSeek's thinking-mode tool protocol requires reasoning_content on every
 * assistant message that is replayed after tools are advertised. VS Code can
 * provide an assistant turn without a visible thinking part when the upstream
 * response contains no reasoning tokens. Preserve the required fields in that
 * case instead of sending an invalid history to the LiteLLM/vLLM gateway.
 */
function preserveDeepSeekReasoningContent(
	rb: Record<string, unknown>,
	extraBody: Record<string, unknown>
): void {
	if (!Array.isArray(rb.tools) || rb.tools.length === 0 || !isThinkingEnabled(rb, extraBody)) {
		return;
	}
	if (!Array.isArray(rb.messages)) {
		return;
	}

	for (const message of rb.messages) {
		if (!isPlainObject(message) || message.role !== "assistant") {
			continue;
		}
		if (message.reasoning_content === undefined || message.reasoning_content === null) {
			message.reasoning_content = "";
		}
		if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && (message.content === undefined || message.content === null)) {
			message.content = "";
		}
	}
}

function isThinkingEnabled(rb: Record<string, unknown>, extraBody: Record<string, unknown>): boolean {
	const topLevelThinking = isPlainObject(rb.thinking) ? rb.thinking : undefined;
	const nestedThinking = isPlainObject(extraBody.thinking) ? extraBody.thinking : undefined;
	return topLevelThinking?.type === "enabled" || nestedThinking?.type === "enabled";
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
	if (model?.thinking?.clear_thinking !== undefined) {
		thinking.clear_thinking = model.thinking.clear_thinking;
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

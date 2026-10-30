import { ProvideLanguageModelChatResponseOptions } from "vscode";

import type { HFModelItem } from "../types";
import { convertToolsToOpenAI } from "../utils";

import { resolveOpenAICompatiblePromptCacheKey } from "./openaiCompatibleCache";
import { OpenaiApi } from "./openaiApi";

/** Official GPT-6 Astra plus dated snapshots (`gpt-6-astra-…`). */
const GPT6_ASTRA_MODEL_PATTERN = /^gpt-6-astra(?:-|$)/;

/** Official GPT-6.1 Sol plus dated snapshots (`gpt-6.1-sol-…`). */
const GPT61_SOL_MODEL_PATTERN = /^gpt-6\.1-sol(?:-|$)/;

/**
 * Mirrors chathub's `providers/openaicompatible` adapter, which conservatively drops sampling
 * controls for GPT-6 Astra and GPT-6.1 Sol rather than assuming every gateway accepts them.
 * This is compatibility parity, not a demonstrated requirement of every compatible gateway.
 */
export function shouldPruneOpenAICompatibleSampling(modelId: string): boolean {
	const normalized = modelId.trim();
	return GPT6_ASTRA_MODEL_PATTERN.test(normalized) || GPT61_SOL_MODEL_PATTERN.test(normalized);
}

/**
 * Chat Completions adapter for a generic OpenAI-compatible gateway.
 *
 * The request body is rebuilt from an explicit allowlist instead of extending the OpenAI body:
 * only fields a compatible gateway is expected to understand are forwarded, and provider-specific
 * controls (thinking, OpenRouter-style reasoning, top_k/min_p, repetition penalties) are omitted
 * unless the user opts in through `extra`.
 */
export class OpenaiCompatibleApi extends OpenaiApi {
	constructor(modelId: string) {
		super(modelId, "openai-compatible");
	}

	prepareRequestBody(
		rb: Record<string, unknown>,
		um: HFModelItem | undefined,
		options?: ProvideLanguageModelChatResponseOptions
	): Record<string, unknown> {
		const modelId = typeof rb.model === "string" ? rb.model : this._modelId;
		const pruneSampling = shouldPruneOpenAICompatibleSampling(modelId);

		const body: Record<string, unknown> = {
			model: modelId,
			messages: rb.messages,
			stream: rb.stream ?? true,
		};
		if (rb.stream_options !== undefined) {
			body.stream_options = rb.stream_options;
		} else if (body.stream !== false) {
			body.stream_options = { include_usage: true };
		}

		if (!pruneSampling) {
			if (um?.temperature !== undefined && um.temperature !== null) {
				body.temperature = um.temperature;
			}
			if (um?.top_p !== undefined && um.top_p !== null) {
				body.top_p = um.top_p;
			}
			if (um?.frequency_penalty !== undefined) {
				body.frequency_penalty = um.frequency_penalty;
			}
			if (um?.presence_penalty !== undefined) {
				body.presence_penalty = um.presence_penalty;
			}
		}

		// Compatible gateways standardize on max_tokens; max_completion_tokens is not forwarded.
		const maxTokens = um?.max_tokens ?? um?.max_completion_tokens;
		if (maxTokens !== undefined) {
			body.max_tokens = maxTokens;
		}

		// Chat Completions only understands the top-level reasoning_effort field. Rows may store
		// the effort in the nested OpenRouter-style `reasoning` object, so resolve that fallback
		// here instead of emitting the object.
		const reasoningEffort = resolveReasoningEffort(um);
		if (reasoningEffort !== undefined) {
			body.reasoning_effort = reasoningEffort;
		}

		if (options?.modelOptions) {
			const mo = options.modelOptions as Record<string, unknown>;
			if (typeof mo.stop === "string" || Array.isArray(mo.stop)) {
				body.stop = mo.stop;
			}
		}

		const toolConfig = convertToolsToOpenAI(options);
		if (toolConfig.tools) {
			body.tools = toolConfig.tools;
		}
		if (toolConfig.tool_choice) {
			body.tool_choice = toolConfig.tool_choice;
		}

		if (um?.extra && typeof um.extra === "object") {
			for (const [key, value] of Object.entries(um.extra)) {
				if (value === undefined) {
					continue;
				}
				if (key === "tools" && Array.isArray(value) && Array.isArray(body.tools)) {
					body.tools = [...body.tools, ...value];
				} else {
					body[key] = value;
				}
			}
		}

		// An explicit `extra.prompt_cache_key` wins over the derived conversation key.
		if (body.prompt_cache_key === undefined) {
			const promptCacheKey = resolveOpenAICompatiblePromptCacheKey({ model: um, modelId, body });
			if (promptCacheKey !== undefined) {
				body.prompt_cache_key = promptCacheKey;
			}
		}
		// This adapter owns prompt-cache selection for the compatible mode, so it also forwards an
		// explicitly configured retention window instead of relying on the generic OpenAI shaping.
		const retention = um?.prompt_cache?.retention;
		if (
			body.prompt_cache_key !== undefined &&
			um?.prompt_cache?.enabled !== false &&
			(retention === "in_memory" || retention === "24h")
		) {
			body.prompt_cache_retention = retention;
		}

		return body;
	}
}

function resolveReasoningEffort(model: HFModelItem | undefined): string | undefined {
	const topLevel = model?.reasoning_effort?.trim();
	if (topLevel) {
		return topLevel;
	}
	const nested = model?.reasoning?.effort?.trim();
	return nested ? nested : undefined;
}

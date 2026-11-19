import { createHash } from "crypto";

import { stableStringify } from "../stableHash";
import type { HFModelItem } from "../types";

/**
 * Derive a stable prompt-cache routing key for an OpenAI-compatible gateway.
 *
 * The seed covers the model, reasoning effort, tool selection and the system / developer
 * messages: the prefix that conversations share. chathub's `deriveCompatPromptCacheKey`
 * (packages/model-runtime/src/core/openaiCompatibleFactory/openaicompatCache.ts) also seeds the
 * first user message. That is left out here because a gateway uses the key as upstream affinity,
 * and a per-conversation key starts each new conversation on a cold cache for the shared prefix.
 */
export function deriveOpenAICompatiblePromptCacheKey(options: {
	modelId: string;
	body: Record<string, unknown>;
}): string | undefined {
	const parts = buildSeedParts(options.modelId, options.body);
	if (parts.length === 0) {
		return undefined;
	}
	const hash = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
	return `oaiproxy-cc-${hash}`;
}

/**
 * Resolve the `prompt_cache_key` to send for this request.
 *
 * Caching is opt-in: `prompt_cache.enabled: true` or an explicit `prompt_cache.retention` derives
 * a key, `prompt_cache.key` wins over derivation, and `prompt_cache.enabled: false` suppresses
 * the hint entirely.
 */
export function resolveOpenAICompatiblePromptCacheKey(options: {
	model: HFModelItem | undefined;
	modelId: string;
	body: Record<string, unknown>;
}): string | undefined {
	const config = options.model?.prompt_cache;
	if (config?.enabled === false) {
		return undefined;
	}
	const explicitKey = typeof config?.key === "string" ? config.key.trim() : "";
	if (explicitKey) {
		return explicitKey;
	}
	// A configured retention window is also an opt-in signal, matching the OpenAI mode where an
	// explicit retention counts as cache configuration.
	const retentionRequested = config?.retention === "in_memory" || config?.retention === "24h";
	if (config?.enabled !== true && !retentionRequested) {
		return undefined;
	}
	return deriveOpenAICompatiblePromptCacheKey({ modelId: options.modelId, body: options.body });
}

function buildSeedParts(modelId: string, body: Record<string, unknown>): string[] {
	const parts: string[] = [];
	const trimmedModel = modelId.trim();
	if (trimmedModel) {
		parts.push(`model=${trimmedModel}`);
	}

	const reasoning = body.reasoning;
	if (reasoning !== undefined) {
		parts.push(`reasoning=${stableStringify(reasoning)}`);
	} else if (typeof body.reasoning_effort === "string" && body.reasoning_effort.trim()) {
		parts.push(`reasoning_effort=${body.reasoning_effort.trim()}`);
	}

	if (body.tool_choice !== undefined) {
		parts.push(`tool_choice=${stableStringify(body.tool_choice)}`);
	}
	if (Array.isArray(body.tools) && body.tools.length > 0) {
		parts.push(`tools=${stableStringify(body.tools)}`);
	}

	const messages = body.messages;
	if (Array.isArray(messages)) {
		for (const message of messages) {
			if (!message || typeof message !== "object") {
				continue;
			}
			const entry = message as Record<string, unknown>;
			const role = typeof entry.role === "string" ? entry.role.trim() : "";
			if (role === "system" || role === "developer") {
				parts.push(`${role}=${stableStringify(entry.content)}`);
			}
		}
	}

	return parts;
}

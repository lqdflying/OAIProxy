import * as vscode from "vscode";
import type { HFModelItem } from "./types";
import { logger } from "./logger";

export const CACHE_CONTROL_MIME = "cache_control";

export interface AnthropicCacheControl {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

export interface CacheUsageSummary {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cachedTokens?: number;
	promptCacheHitTokens?: number;
	promptCacheMissTokens?: number;
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
	cachedContentTokenCount?: number;
	cacheCreation?: Record<string, unknown>;
	cacheTokensDetails?: unknown[];
}

interface OpenAIPromptCacheTarget {
	model?: HFModelItem;
	baseUrl: string;
	modelId: string;
}

export function applyOpenAIPromptCache(
	requestBody: Record<string, unknown>,
	target: OpenAIPromptCacheTarget
): void {
	const config = target.model?.prompt_cache;
	if (config?.enabled === false) {
		return;
	}

	const hasExplicitConfig =
		(typeof config?.key === "string" && config.key.trim() !== "") || config?.retention !== undefined;
	const shouldAutoEnable = isOfficialOpenAIEndpoint(target.model, target.baseUrl);
	if (!hasExplicitConfig && !shouldAutoEnable) {
		return;
	}

	if (requestBody.prompt_cache_key === undefined) {
		requestBody.prompt_cache_key = typeof config?.key === "string" && config.key.trim()
			? config.key.trim()
			: createDefaultPromptCacheKey(target.model, target.modelId);
	}

	if (
		requestBody.prompt_cache_retention === undefined &&
		(config?.retention === "in_memory" || config?.retention === "24h")
	) {
		requestBody.prompt_cache_retention = config.retention;
	}
}

export function isCacheControlPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType === CACHE_CONTROL_MIME;
}

export function parseCacheControlPart(part: unknown): AnthropicCacheControl | null {
	if (!isCacheControlPart(part)) {
		return null;
	}

	let text = "";
	try {
		text = new TextDecoder().decode(part.data).trim();
	} catch {
		return { type: "ephemeral" };
	}

	if (!text) {
		return { type: "ephemeral" };
	}

	if (text === "1h" || text === "5m") {
		return { type: "ephemeral", ttl: text };
	}

	try {
		const parsed = JSON.parse(text);
		const candidate = isPlainObject(parsed) && isPlainObject(parsed.cache_control)
			? parsed.cache_control
			: parsed;
		return normalizeAnthropicCacheControl(candidate);
	} catch {
		return { type: "ephemeral" };
	}
}

export function createAnthropicCacheControl(model: HFModelItem | undefined): AnthropicCacheControl {
	const ttl = model?.prompt_cache?.anthropic?.ttl;
	return ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

export function isAnthropicPromptCacheEnabled(model: HFModelItem | undefined): boolean {
	if (model?.prompt_cache?.enabled === false) {
		return false;
	}
	return model?.prompt_cache?.anthropic?.enabled === true;
}

export function shouldCacheAnthropicSystem(model: HFModelItem | undefined): boolean {
	if (!isAnthropicPromptCacheEnabled(model)) {
		return false;
	}
	return model?.prompt_cache?.anthropic?.cache_system !== false;
}

export function shouldCacheAnthropicTools(model: HFModelItem | undefined): boolean {
	if (!isAnthropicPromptCacheEnabled(model)) {
		return false;
	}
	return model?.prompt_cache?.anthropic?.cache_tools !== false;
}

export function hasCacheControl(value: unknown): boolean {
	return isPlainObject(value) && isPlainObject(value.cache_control);
}

export function applyCacheControl<T extends Record<string, unknown>>(
	value: T,
	cacheControl: AnthropicCacheControl | null
): T {
	if (!cacheControl || hasCacheControl(value)) {
		return value;
	}
	(value as Record<string, unknown>).cache_control = cacheControl;
	return value;
}

export function logCacheUsage(apiMode: string, modelId: string, payload: unknown): void {
	const usage = extractCacheUsage(payload);
	if (!usage) {
		return;
	}
	logger.info("cache.usage", {
		apiMode,
		modelId,
		...usage,
	});
}

export function extractCacheUsage(payload: unknown): CacheUsageSummary | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}

	const obj = payload as Record<string, unknown>;
	const summary: CacheUsageSummary = {};
	let hasCacheField = false;

	for (const usage of findUsageObjects(obj)) {
		hasCacheField = addUsageMetrics(summary, usage) || hasCacheField;
	}

	const usageMetadata = asObject(obj.usageMetadata) ?? asObject(obj.usage_metadata);
	if (usageMetadata) {
		hasCacheField = addGeminiUsageMetadata(summary, usageMetadata) || hasCacheField;
	}

	return hasCacheField ? summary : null;
}

function isOfficialOpenAIEndpoint(model: HFModelItem | undefined, baseUrl: string): boolean {
	const provider = model?.owned_by?.trim().toLowerCase();
	if (provider === "openai") {
		return true;
	}

	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		return host === "api.openai.com";
	} catch {
		return false;
	}
}

function createDefaultPromptCacheKey(model: HFModelItem | undefined, modelId: string): string {
	const provider = model?.owned_by?.trim() || "openai";
	const raw = `oaiproxy-${provider}-${modelId}`;
	return raw.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 128);
}

function normalizeAnthropicCacheControl(value: unknown): AnthropicCacheControl | null {
	if (!isPlainObject(value)) {
		return { type: "ephemeral" };
	}

	if (value.type !== undefined && value.type !== "ephemeral") {
		return { type: "ephemeral" };
	}

	const out: AnthropicCacheControl = { type: "ephemeral" };
	if (value.ttl === "1h" || value.ttl === "5m") {
		out.ttl = value.ttl;
	}
	return out;
}

function findUsageObjects(obj: Record<string, unknown>): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	const directUsage = asObject(obj.usage);
	if (directUsage) {
		out.push(directUsage);
	}

	const message = asObject(obj.message);
	const messageUsage = message ? asObject(message.usage) : null;
	if (messageUsage) {
		out.push(messageUsage);
	}

	const response = asObject(obj.response);
	const responseUsage = response ? asObject(response.usage) : null;
	if (responseUsage) {
		out.push(responseUsage);
	}

	return out;
}

function addUsageMetrics(summary: CacheUsageSummary, usage: Record<string, unknown>): boolean {
	let hasCacheField = false;

	assignNumber(summary, "inputTokens", usage.input_tokens);
	assignNumber(summary, "inputTokens", usage.prompt_tokens);
	assignNumber(summary, "outputTokens", usage.output_tokens);
	assignNumber(summary, "outputTokens", usage.completion_tokens);
	assignNumber(summary, "totalTokens", usage.total_tokens);

	hasCacheField = assignNumber(summary, "promptCacheHitTokens", usage.prompt_cache_hit_tokens) || hasCacheField;
	hasCacheField = assignNumber(summary, "promptCacheMissTokens", usage.prompt_cache_miss_tokens) || hasCacheField;
	hasCacheField = assignNumber(summary, "cacheReadInputTokens", usage.cache_read_input_tokens) || hasCacheField;
	hasCacheField = assignNumber(summary, "cacheCreationInputTokens", usage.cache_creation_input_tokens) || hasCacheField;

	const promptDetails = asObject(usage.prompt_tokens_details);
	if (promptDetails) {
		hasCacheField = assignNumber(summary, "cachedTokens", promptDetails.cached_tokens) || hasCacheField;
	}

	const cacheCreation = asObject(usage.cache_creation);
	if (cacheCreation) {
		summary.cacheCreation = cacheCreation;
		hasCacheField = true;
	}

	return hasCacheField;
}

function addGeminiUsageMetadata(summary: CacheUsageSummary, usageMetadata: Record<string, unknown>): boolean {
	let hasCacheField = false;

	assignNumber(summary, "inputTokens", usageMetadata.promptTokenCount);
	assignNumber(summary, "inputTokens", usageMetadata.prompt_token_count);
	assignNumber(summary, "outputTokens", usageMetadata.candidatesTokenCount);
	assignNumber(summary, "outputTokens", usageMetadata.candidates_token_count);
	assignNumber(summary, "totalTokens", usageMetadata.totalTokenCount);
	assignNumber(summary, "totalTokens", usageMetadata.total_token_count);

	hasCacheField =
		assignNumber(summary, "cachedContentTokenCount", usageMetadata.cachedContentTokenCount) || hasCacheField;
	hasCacheField =
		assignNumber(summary, "cachedContentTokenCount", usageMetadata.cached_content_token_count) || hasCacheField;

	const cacheTokensDetails = Array.isArray(usageMetadata.cacheTokensDetails)
		? usageMetadata.cacheTokensDetails
		: Array.isArray(usageMetadata.cache_tokens_details)
			? usageMetadata.cache_tokens_details
			: undefined;
	if (cacheTokensDetails) {
		summary.cacheTokensDetails = cacheTokensDetails;
		hasCacheField = true;
	}

	return hasCacheField;
}

function assignNumber<K extends keyof CacheUsageSummary>(
	target: CacheUsageSummary,
	key: K,
	value: unknown
): boolean {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return false;
	}
	(target as Record<string, unknown>)[key] = value;
	return true;
}

function asObject(value: unknown): Record<string, unknown> | null {
	return isPlainObject(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

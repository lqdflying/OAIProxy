import * as assert from "assert";
import * as vscode from "vscode";
import type { HFModelItem } from "../types";
import { AnthropicApi } from "../anthropic/anthropicApi";
import { getLatestCacheUsage, resetCacheUsageForTests } from "../cacheUsage";
import {
	applyOpenAIPromptCache,
	extractCacheUsage,
	isAnthropicPromptCacheEnabled,
	logCacheUsage,
	parseCacheControlPart,
} from "../promptCache";

suite("promptCache", () => {
	teardown(() => {
		resetCacheUsageForTests();
	});

	test("applies OpenAI prompt cache key only for official OpenAI by default", () => {
		const openaiBody: Record<string, unknown> = {};
		applyOpenAIPromptCache(openaiBody, {
			model: model({ id: "gpt-5.1", owned_by: "openai" }),
			baseUrl: "https://api.openai.com/v1",
			modelId: "gpt-5.1",
		});

		assert.strictEqual(openaiBody.prompt_cache_key, "oaiproxy-openai-gpt-5.1");

		const deepseekBody: Record<string, unknown> = {};
		applyOpenAIPromptCache(deepseekBody, {
			model: model({ id: "deepseek-chat", owned_by: "deepseek" }),
			baseUrl: "https://api.deepseek.com",
			modelId: "deepseek-chat",
		});

		assert.strictEqual(deepseekBody.prompt_cache_key, undefined);

		const mimoBody: Record<string, unknown> = {};
		applyOpenAIPromptCache(mimoBody, {
			model: model({ id: "mimo-v2.5-pro", owned_by: "mimo" }),
			baseUrl: "https://api.xiaomimimo.com/v1",
			modelId: "mimo-v2.5-pro",
		});

		assert.strictEqual(mimoBody.prompt_cache_key, undefined);
	});

	test("respects explicit OpenAI prompt cache configuration", () => {
		const body: Record<string, unknown> = {
			prompt_cache_key: "from-extra",
		};
		applyOpenAIPromptCache(body, {
			model: model({
				id: "custom-model",
				owned_by: "custom",
				prompt_cache: {
					key: "configured-key",
					retention: "24h",
				},
			}),
			baseUrl: "https://example.test/v1",
			modelId: "custom-model",
		});

		assert.strictEqual(body.prompt_cache_key, "from-extra");
		assert.strictEqual(body.prompt_cache_retention, "24h");
	});

	test("uses Fireworks user affinity without sending OpenAI prompt cache fields", () => {
		const body: Record<string, unknown> = {};
		applyOpenAIPromptCache(body, {
			model: model({
				id: "accounts/fireworks/models/kimi-k2p7-code",
				owned_by: "fireworks",
				prompt_cache: {
					enabled: true,
				},
			}),
			baseUrl: "https://api.fireworks.ai/inference/v1",
			modelId: "accounts/fireworks/models/kimi-k2p7-code",
		});

		assert.strictEqual(body.user, "oaiproxy-fireworks-accounts-fireworks-models-kimi-k2p7-code");
		assert.strictEqual(body.prompt_cache_key, undefined);
		assert.strictEqual(body.prompt_cache_retention, undefined);
	});

	test("enables Anthropic cache control for known Anthropic-compatible endpoints by default", () => {
		assert.strictEqual(
			isAnthropicPromptCacheEnabled(model({
				id: "MiniMax-M3",
				owned_by: "minimax-anthropic",
				apiMode: "anthropic",
				baseUrl: "https://api.minimax.io/anthropic",
			})),
			true
		);
		assert.strictEqual(
			isAnthropicPromptCacheEnabled(model({
				id: "custom",
				owned_by: "custom",
				apiMode: "anthropic",
				baseUrl: "https://example.test/anthropic",
			})),
			false
		);
		assert.strictEqual(
			isAnthropicPromptCacheEnabled(model({
				id: "MiniMax-M3",
				owned_by: "minimax-anthropic",
				apiMode: "anthropic",
				baseUrl: "https://api.minimax.io/anthropic",
				prompt_cache: {
					enabled: false,
				},
			})),
			false
		);
	});

	test("parses cache_control data parts", () => {
		const data = new TextEncoder().encode(JSON.stringify({ type: "ephemeral", ttl: "1h" }));
		const part = new vscode.LanguageModelDataPart(data, "cache_control");

		assert.deepStrictEqual(parseCacheControlPart(part), {
			type: "ephemeral",
			ttl: "1h",
		});
	});

	test("extracts provider cache usage shapes", () => {
		assert.deepStrictEqual(
			extractCacheUsage({
				usage: {
					prompt_tokens: 2000,
					prompt_tokens_details: {
						cached_tokens: 1500,
					},
				},
			}),
			{
				inputTokens: 2000,
				cachedTokens: 1500,
			}
		);

		assert.deepStrictEqual(
			extractCacheUsage({
				usage: {
					prompt_cache_hit_tokens: 120,
					prompt_cache_miss_tokens: 30,
				},
			}),
			{
				promptCacheHitTokens: 120,
				promptCacheMissTokens: 30,
			}
		);

		assert.deepStrictEqual(
			extractCacheUsage({
				type: "response.completed",
				response: {
					usage: {
						input_tokens: 4096,
						output_tokens: 12,
						total_tokens: 4108,
						input_tokens_details: {
							cached_tokens: 3072,
						},
					},
				},
			}),
			{
				inputTokens: 4096,
				outputTokens: 12,
				totalTokens: 4108,
				cachedTokens: 3072,
			}
		);

		assert.deepStrictEqual(
			extractCacheUsage({
				usage: {
					prompt_tokens: 2048,
					cached_tokens: 1024,
				},
			}),
			{
				inputTokens: 2048,
				cachedTokens: 1024,
			}
		);

		assert.deepStrictEqual(
			extractCacheUsage({
				usage: {
					completion_tokens: 574,
					prompt_tokens: 1085,
					total_tokens: 1659,
					prompt_tokens_details: {
						cached_tokens: 1081,
					},
				},
			}),
			{
				inputTokens: 1085,
				outputTokens: 574,
				totalTokens: 1659,
				cachedTokens: 1081,
			}
		);

		assert.deepStrictEqual(
			extractCacheUsage({
				usage: {
					input_tokens: 10,
					cache_creation_input_tokens: 4,
					cache_read_input_tokens: 20,
				},
			}),
			{
				inputTokens: 10,
				cacheReadInputTokens: 20,
				cacheCreationInputTokens: 4,
			}
		);

		assert.deepStrictEqual(
			extractCacheUsage({
				usageMetadata: {
					promptTokenCount: 100,
					cachedContentTokenCount: 80,
				},
			}),
			{
				inputTokens: 100,
				cachedContentTokenCount: 80,
			}
		);
	});

	test("records cache usage hit rate across provider shapes", () => {
		logCacheUsage("openai", "gpt-test", {
			usage: {
				prompt_tokens: 2000,
				prompt_tokens_details: {
					cached_tokens: 1500,
				},
			},
		});

		let latest = getLatestCacheUsage("gpt-test");
		assert.strictEqual(latest?.status, "hit");
		assert.strictEqual(latest?.cacheHitTokens, 1500);
		assert.strictEqual(latest?.cacheEligibleTokens, 2000);
		assert.strictEqual(latest?.cacheHitRate, 0.75);

		logCacheUsage("deepseek", "deepseek-test", {
			usage: {
				prompt_cache_hit_tokens: 120,
				prompt_cache_miss_tokens: 30,
			},
		});

		latest = getLatestCacheUsage("deepseek-test");
		assert.strictEqual(latest?.status, "hit");
		assert.strictEqual(latest?.cacheHitTokens, 120);
		assert.strictEqual(latest?.cacheEligibleTokens, 150);
		assert.strictEqual(latest?.cacheHitRate, 0.8);

		logCacheUsage("anthropic", "claude-test", {
			usage: {
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 400,
			},
		});

		latest = getLatestCacheUsage("claude-test");
		assert.strictEqual(latest?.status, "miss");
		assert.strictEqual(latest?.cacheHitTokens, 0);
		assert.strictEqual(latest?.cacheEligibleTokens, 400);
		assert.strictEqual(latest?.cacheHitRate, 0);
	});

	test("preserves Anthropic cache_control message markers", () => {
		const api = new AnthropicApi("claude-sonnet");
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.User,
					name: undefined,
					content: [
						new vscode.LanguageModelTextPart("stable context"),
						new vscode.LanguageModelDataPart(
							new TextEncoder().encode(JSON.stringify({ type: "ephemeral", ttl: "1h" })),
							"cache_control"
						),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false }
		);

		const content = messages[0].content as unknown as Array<Record<string, unknown>>;
		assert.deepStrictEqual(content[0].cache_control, {
			type: "ephemeral",
			ttl: "1h",
		});
	});

	test("adds Anthropic cache_control to configured system and tools", () => {
		const api = new AnthropicApi("claude-sonnet");
		api.convertMessages(
			[
				{
					role: 0 as vscode.LanguageModelChatMessageRole,
					name: undefined,
					content: [new vscode.LanguageModelTextPart("system prompt")],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false }
		);

		const body = api.prepareRequestBody(
			{
				model: "claude-sonnet",
				messages: [],
				stream: true,
			},
			model({
				id: "claude-sonnet",
				owned_by: "anthropic",
				prompt_cache: {
					anthropic: {
						enabled: true,
						ttl: "1h",
					},
				},
			}),
			{
				requestInitiator: "test",
				tools: [
					{
						name: "get_weather",
						description: "Get weather",
						inputSchema: {
							type: "object",
							properties: {},
						},
					},
				],
				toolMode: vscode.LanguageModelChatToolMode.Auto,
			} as unknown as vscode.ProvideLanguageModelChatResponseOptions
		);

		const system = body.system as unknown as Array<Record<string, unknown>>;
		assert.deepStrictEqual(system[0].cache_control, {
			type: "ephemeral",
			ttl: "1h",
		});
		assert.deepStrictEqual(body.tools?.[0].cache_control, {
			type: "ephemeral",
			ttl: "1h",
		});
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

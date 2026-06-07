import * as assert from "assert";
import { resolveBatchAddModels, resolveBatchDeleteModels, resolveProviderApiKeyChange } from "../views/configView";
import { getMissingProviderSetupMessage, resolveProviderBackedModel } from "../providerTransport";
import type { HFModelItem } from "../types";

suite("configView", () => {
	test("stores trimmed provider API keys under the lowercase provider secret", () => {
		assert.deepStrictEqual(resolveProviderApiKeyChange("OpenAI", "  sk-test  "), {
			kind: "store",
			secretKey: "oaicopilot.apiKey.openai",
			legacySecretKey: "oaicopilot.apiKey.OpenAI",
			value: "sk-test",
		});
	});

	test("preserves provider API keys when the UI sends an empty key without clear intent", () => {
		assert.deepStrictEqual(resolveProviderApiKeyChange("deepseek", undefined), {
			kind: "preserve",
			secretKey: "oaicopilot.apiKey.deepseek",
			legacySecretKey: undefined,
		});
		assert.deepStrictEqual(resolveProviderApiKeyChange("deepseek", "   "), {
			kind: "preserve",
			secretKey: "oaicopilot.apiKey.deepseek",
			legacySecretKey: undefined,
		});
	});

	test("deletes provider API keys only with the explicit clear flag", () => {
		assert.deepStrictEqual(resolveProviderApiKeyChange("Kimi", undefined, true), {
			kind: "delete",
			secretKey: "oaicopilot.apiKey.kimi",
			legacySecretKey: "oaicopilot.apiKey.Kimi",
		});
	});

	test("batch add appends only unconfigured models", () => {
		const existing = [
			model({ id: "MiniMax-M3", configId: "anthropic", owned_by: "minimax-anthropic" }),
			model({ id: "gpt-5.5", owned_by: "openai" }),
		];
		const candidate = [
			model({ id: "MiniMax-M3", configId: "anthropic", owned_by: "minimax-anthropic" }),
			model({ id: "claude-sonnet-4-6", owned_by: "anthropic" }),
			model({ id: "claude-sonnet-4-6", owned_by: "anthropic" }),
		];

		const result = resolveBatchAddModels(existing, candidate);

		assert.deepStrictEqual(result.added.map((item) => item.id), ["claude-sonnet-4-6"]);
		assert.strictEqual(result.skipped.length, 2);
		assert.deepStrictEqual(result.models.map((item) => `${item.id}${item.configId ? "::" + item.configId : ""}`), [
			"MiniMax-M3::anthropic",
			"gpt-5.5",
			"claude-sonnet-4-6",
		]);
	});

	test("batch add never creates hidden provider rows for inherited models", () => {
		const result = resolveBatchAddModels(
			[],
			[
				model({
					id: "MiniMax-M3",
					configId: "anthropic",
					owned_by: "minimax-anthropic",
					baseUrl: "https://api.minimax.io/anthropic",
					apiMode: "anthropic",
					headers: { "X-Test": "1" },
				}),
			],
			{ inheritProvider: true }
		);

		assert.strictEqual(result.models.some((item) => item.id.startsWith("__provider__")), false);
		assert.strictEqual(result.added[0].baseUrl, undefined);
		assert.strictEqual(result.added[0].apiMode, undefined);
		assert.strictEqual(result.added[0].headers, undefined);
		assert.strictEqual(result.added[0].inheritProvider, true);
	});

	test("batch add can use local provider config without writing it into model JSON", () => {
		const result = resolveBatchAddModels(
			[],
			[
				model({
					id: "MiniMax-M3",
					configId: "anthropic",
					owned_by: "minimax-anthropic",
					baseUrl: "https://api.minimax.io/anthropic",
					apiMode: "anthropic",
				}),
			],
			{
				inheritProvider: true,
				providerConfigs: [
					{
						provider: "minimax-anthropic",
						baseUrl: "https://proxy.example.test/anthropic",
						apiMode: "anthropic",
					},
				],
			}
		);

		assert.strictEqual(result.models.some((item) => item.id === "__provider__minimax-anthropic"), false);
		assert.strictEqual(result.added[0].baseUrl, undefined);
		const resolved = resolveProviderBackedModel(result.added[0], result.models, [
			{
				provider: "minimax-anthropic",
				baseUrl: "https://proxy.example.test/anthropic",
				apiMode: "anthropic",
			},
		]);
		assert.strictEqual(resolved?.baseUrl, "https://proxy.example.test/anthropic");
	});

	test("batch add does not create a provider row when an existing model already carries provider transport", () => {
		const existing = [
			model({
				id: "kimi-k2.6",
				displayName: "Kimi K2.6",
				owned_by: "kimi",
				baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
				apiMode: "openai",
			}),
		];

		const result = resolveBatchAddModels(
			existing,
			[
				model({
					id: "kimi-k2.5",
					displayName: "Kimi K2.5",
					owned_by: "kimi",
					inheritProvider: true,
				}),
			],
			{ inheritProvider: true }
		);

		assert.strictEqual(result.models.some((item) => item.id === "__provider__kimi"), false);
		assert.strictEqual(result.added[0].baseUrl, undefined);

		const resolved = resolveProviderBackedModel(result.added[0], result.models);
		assert.strictEqual(
			resolved?.baseUrl,
			"https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
		);
		assert.strictEqual(resolved?.apiMode, "openai");
	});

	test("batch add does not create provider row when payload is already stripped", () => {
		const result = resolveBatchAddModels(
			[],
			[
				model({
					id: "gpt-5.5",
					owned_by: "openai",
					inheritProvider: true,
				}),
			],
			{ inheritProvider: true }
		);

		assert.strictEqual(result.models.some((item) => item.id === "__provider__openai"), false);
		assert.strictEqual(result.added[0].baseUrl, undefined);
		assert.strictEqual(result.added[0].apiMode, undefined);
	});

	test("batch add keeps manual model transport fields by default", () => {
		const result = resolveBatchAddModels(
			[],
			[
				model({
					id: "custom-model",
					owned_by: "custom",
					baseUrl: "https://manual.example.test/v1",
					apiMode: "openai",
				}),
			]
		);

		assert.strictEqual(result.added[0].baseUrl, "https://manual.example.test/v1");
		assert.strictEqual(result.added[0].apiMode, "openai");
		assert.strictEqual(result.added[0].inheritProvider, undefined);
	});

	test("batch add keeps generated provider transport inside model JSON by default", () => {
		const result = resolveBatchAddModels(
			[],
			[
				model({
					id: "kimi-k2.5",
					owned_by: "kimi",
					baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
					apiMode: "openai",
				}),
			]
		);

		assert.strictEqual(result.models.some((item) => item.id === "__provider__kimi"), false);
		assert.strictEqual(
			result.added[0].baseUrl,
			"https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
		);
		assert.strictEqual(result.added[0].apiMode, "openai");
		assert.strictEqual(result.added[0].inheritProvider, undefined);
	});

	test("runtime resolution uses provider transport for inherited models", () => {
		const providerRow = model({
			id: "__provider__minimax-anthropic",
			owned_by: "minimax-anthropic",
			baseUrl: "https://proxy.example.test/anthropic",
			apiMode: "anthropic",
			headers: { "X-Provider": "1" },
		});
		const inherited = model({
			id: "MiniMax-M3",
			configId: "anthropic",
			owned_by: "minimax-anthropic",
			inheritProvider: true,
		});

		const resolved = resolveProviderBackedModel(inherited, [providerRow, inherited]);

		assert.strictEqual(resolved?.baseUrl, "https://proxy.example.test/anthropic");
		assert.strictEqual(resolved?.apiMode, "anthropic");
		assert.deepStrictEqual(resolved?.headers, { "X-Provider": "1" });
	});

	test("runtime setup reminder is raised for synced inherited models without local provider setup", () => {
		const inherited = model({
			id: "kimi-k2.5",
			owned_by: "kimi",
			inheritProvider: true,
		});

		const message = getMissingProviderSetupMessage(inherited, [inherited], []);

		assert.ok(message?.includes("Provider kimi is not configured"));
		assert.ok(message?.includes("Provider Management"));
	});

	test("runtime setup reminder is not raised when local provider setup exists", () => {
		const inherited = model({
			id: "kimi-k2.5",
			owned_by: "kimi",
			inheritProvider: true,
		});

		const message = getMissingProviderSetupMessage(inherited, [inherited], [
			{
				provider: "kimi",
				baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
				apiMode: "openai",
			},
		]);

		assert.strictEqual(message, undefined);
	});

	test("runtime resolution lets manual custom transport win", () => {
		const providerRow = model({
			id: "__provider__custom",
			owned_by: "custom",
			baseUrl: "https://provider.example.test/v1",
			apiMode: "openai",
		});
		const manual = model({
			id: "manual-model",
			owned_by: "custom",
			baseUrl: "https://manual.example.test/v1",
			apiMode: "openai",
		});

		const resolved = resolveProviderBackedModel(manual, [providerRow, manual]);

		assert.strictEqual(resolved?.baseUrl, "https://manual.example.test/v1");
	});

	test("runtime resolution treats legacy preset transport as provider-inherited", () => {
		const providerRow = model({
			id: "__provider__openai",
			owned_by: "openai",
			baseUrl: "https://proxy.example.test/v1",
			apiMode: "openai-responses",
		});
		const legacyPreset = model({
			id: "gpt-5.5",
			owned_by: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiMode: "openai-responses",
		});

		const resolved = resolveProviderBackedModel(legacyPreset, [providerRow, legacyPreset]);

		assert.strictEqual(resolved?.baseUrl, "https://proxy.example.test/v1");
		assert.strictEqual(resolved?.apiMode, "openai-responses");
	});

	test("batch delete removes multiple configured model IDs", () => {
		const existing = [
			model({ id: "MiniMax-M3", configId: "anthropic", owned_by: "minimax-anthropic" }),
			model({ id: "MiniMax-M3", owned_by: "minimax" }),
			model({ id: "gpt-5.5", owned_by: "openai" }),
		];

		const result = resolveBatchDeleteModels(existing, ["MiniMax-M3::anthropic", "gpt-5.5"]);

		assert.deepStrictEqual(result.removedIds, ["MiniMax-M3::anthropic", "gpt-5.5"]);
		assert.deepStrictEqual(result.models.map((item) => `${item.id}${item.configId ? "::" + item.configId : ""}`), [
			"MiniMax-M3",
		]);
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

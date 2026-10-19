import * as assert from "assert";
import {
	normalizeModelPickerContextLength,
	resolveModelTokenLimits,
} from "../modelTokenLimits";
import { MODEL_PICKER_METADATA } from "../modelPickerMetadata";
import { fetchModels, prepareLanguageModelChatInformation } from "../provideModel";
import * as vscode from "vscode";

suite("provideModel", () => {
	test("fetches Azure Foundry models with api-key authentication", async () => {
		const originalFetch = globalThis.fetch;
		let capturedUrl = "";
		let capturedHeaders: Record<string, string> = {};
		globalThis.fetch = (async (input, init) => {
			capturedUrl = String(input);
			capturedHeaders = init?.headers as Record<string, string>;
			return new Response(JSON.stringify({ data: [{ id: "Kimi-K2.6", owned_by: "azure-foundry" }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		try {
			const result = await fetchModels(
				"https://resource.services.ai.azure.com/openai/v1/",
				"foundry-secret",
				"azure-foundry"
			);
			assert.strictEqual(capturedUrl, "https://resource.services.ai.azure.com/openai/v1/models");
			assert.strictEqual(capturedHeaders["api-key"], "foundry-secret");
			assert.strictEqual(capturedHeaders.Authorization, undefined);
			assert.strictEqual(result.models[0].id, "Kimi-K2.6");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("derives legacy model-list capabilities instead of advertising tools and vision", async () => {
		const originalFetch = globalThis.fetch;
		const originalConfig = vscode.workspace.getConfiguration;
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => {
				if (key === "oaicopilot.models") {
					return [];
				}
				if (key === "oaicopilot.baseUrl") {
					return "https://legacy.example.test/v1";
				}
				return fallback;
			},
		})) as typeof originalConfig;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					data: [
						{
							id: "text-only-model",
							providers: [{ provider: "legacy", supports_tools: false }],
							architecture: { input_modalities: ["text"] },
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			)) as typeof fetch;

		try {
			const infos = await prepareLanguageModelChatInformation(
				{ silent: true },
				{} as vscode.CancellationToken,
				{
					get: async () => "legacy-key",
					store: async () => undefined,
					delete: async () => undefined,
				} as unknown as vscode.SecretStorage
			);

			assert.strictEqual(infos.length, 1);
			assert.strictEqual(infos[0].capabilities.toolCalling, false);
			assert.strictEqual(infos[0].capabilities.imageInput, false);
		} finally {
			globalThis.fetch = originalFetch;
			vscode.workspace.getConfiguration = originalConfig;
		}
	});

	test("uses VS Code 1.126-compatible BYOK picker metadata", () => {
		assert.deepStrictEqual(MODEL_PICKER_METADATA, {
			isUserSelectable: true,
			isBYOK: true,
		});
		assert.strictEqual("category" in MODEL_PICKER_METADATA, false);
	});

	test("normalizes one mebibyte context to one decimal million for picker display", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 1048576,
			max_tokens: 65536,
		});

		assert.strictEqual(normalizeModelPickerContextLength(1048576), 1000000);
		assert.strictEqual(tokenLimits.contextLength, 1048576);
		assert.strictEqual(tokenLimits.advertisedContextLength, 1000000);
		assert.strictEqual(tokenLimits.maxInputTokens, 934464);
		assert.strictEqual(tokenLimits.maxOutputTokens, 65536);
	});

	test("normalizes near-million provider context values", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 1050000,
			max_tokens: 128000,
		});

		assert.strictEqual(tokenLimits.advertisedContextLength, 1000000);
		assert.strictEqual(tokenLimits.maxInputTokens + tokenLimits.maxOutputTokens, 1000000);
	});

	test("preserves non-near-million context values", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 1500000,
			max_tokens: 65536,
		});

		assert.strictEqual(tokenLimits.advertisedContextLength, 1500000);
		assert.strictEqual(tokenLimits.maxInputTokens + tokenLimits.maxOutputTokens, 1500000);
	});

	test("honors conservative max input token budget", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 262144,
			max_input_tokens: 180000,
			max_completion_tokens: 32768,
		});

		assert.strictEqual(tokenLimits.contextLength, 262144);
		assert.strictEqual(tokenLimits.advertisedContextLength, 262144);
		assert.strictEqual(tokenLimits.maxInputTokens, 180000);
		assert.strictEqual(tokenLimits.maxOutputTokens, 32768);
	});

	test("caps max input token budget at context minus output reserve", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 262144,
			max_input_tokens: 999999,
			max_completion_tokens: 32768,
		});

		assert.strictEqual(tokenLimits.maxInputTokens, 229376);
		assert.strictEqual(tokenLimits.maxOutputTokens, 32768);
	});
});

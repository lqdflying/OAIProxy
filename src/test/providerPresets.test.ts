import * as assert from "assert";
import { PROVIDER_PRESETS } from "../providerPresets";

suite("providerPresets", () => {
	test("puts Azure Foundry first with direct endpoint authentication mode", () => {
		const preset = PROVIDER_PRESETS[0];

		assert.strictEqual(preset.id, "azure-foundry");
		assert.strictEqual(preset.label, "Azure Foundry");
		assert.strictEqual(preset.provider, "azure-foundry");
		assert.strictEqual(preset.baseUrl, "https://YOUR-RESOURCE-NAME.services.ai.azure.com/openai/v1");
		assert.strictEqual(preset.apiMode, "azure-foundry");
		assert.strictEqual(preset.sortOrder, -100);
	});

	test("includes TokenRouter OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "tokenrouter");

		assert.ok(preset);
		assert.strictEqual(preset.label, "TokenRouter");
		assert.strictEqual(preset.provider, "tokenrouter");
		assert.strictEqual(preset.baseUrl, "https://api.tokenrouter.com/v1");
		assert.strictEqual(preset.apiMode, "openai");
	});

	test("separates OpenAI OAuth from the API-key provider", () => {
		const apiKeyPreset = PROVIDER_PRESETS.find((item) => item.id === "openai");
		const oauthPreset = PROVIDER_PRESETS.find((item) => item.id === "openai-oauth");

		assert.ok(apiKeyPreset);
		assert.strictEqual(apiKeyPreset.provider, "openai");
		assert.strictEqual(apiKeyPreset.label, "OpenAI (API key)");
		assert.ok(oauthPreset);
		assert.strictEqual(oauthPreset.provider, "openai-oauth");
		assert.strictEqual(oauthPreset.authMode, "oauth");
		assert.strictEqual(oauthPreset.baseUrl, "https://chatgpt.com/backend-api/codex");
	});

	test("includes MiniMax OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "minimax");

		assert.ok(preset);
		assert.strictEqual(preset.label, "MiniMax (OpenAI)");
		assert.strictEqual(preset.provider, "minimax");
		assert.strictEqual(preset.baseUrl, "https://api.minimax.io/v1");
		assert.strictEqual(preset.apiMode, "openai");
	});

	test("includes LiteLLM proxy preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "litellm");

		assert.ok(preset);
		assert.strictEqual(preset.label, "LiteLLM Proxy");
		assert.strictEqual(preset.provider, "litellm");
		assert.strictEqual(preset.baseUrl, "https://ai.nube.sh/api/v1");
		assert.strictEqual(preset.apiMode, "litellm");
	});

	test("includes Fireworks OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "fireworks");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Fireworks AI");
		assert.strictEqual(preset.provider, "fireworks");
		assert.strictEqual(preset.baseUrl, "https://api.fireworks.ai/inference/v1");
		assert.strictEqual(preset.apiMode, "openai");
	});

	test("includes MiniMax Anthropic-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "minimax-anthropic");

		assert.ok(preset);
		assert.strictEqual(preset.label, "MiniMax (Anthropic)");
		assert.strictEqual(preset.provider, "minimax-anthropic");
		assert.strictEqual(preset.baseUrl, "https://api.minimax.io/anthropic");
		assert.strictEqual(preset.apiMode, "anthropic");
	});

	test("includes Xiaomi MiMo OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "mimo");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Xiaomi MiMo");
		assert.strictEqual(preset.provider, "mimo");
		assert.strictEqual(preset.baseUrl, "https://api.xiaomimimo.com/v1");
		assert.strictEqual(preset.apiMode, "openai");
	});

	test("includes Z.AI GLM Coding Plan OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "zai");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Z.AI / Zhipu AI");
		assert.strictEqual(preset.provider, "zai");
		assert.strictEqual(preset.baseUrl, "https://api.z.ai/api/coding/paas/v4");
		assert.strictEqual(preset.apiMode, "openai");
	});

	test("includes Google Gemini native preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "gemini");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Google Gemini");
		assert.strictEqual(preset.provider, "google");
		assert.strictEqual(preset.baseUrl, "https://generativelanguage.googleapis.com");
		assert.strictEqual(preset.apiMode, "gemini");
	});

	test("includes Ollama native preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "ollama");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Ollama");
		assert.strictEqual(preset.provider, "ollama");
		assert.strictEqual(preset.baseUrl, "http://localhost:11434");
		assert.strictEqual(preset.apiMode, "ollama");
	});
});

import * as assert from "assert";
import { PROVIDER_PRESETS } from "../providerPresets";

suite("providerPresets", () => {
	test("includes MiniMax OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "minimax");

		assert.ok(preset);
		assert.strictEqual(preset.label, "MiniMax (OpenAI)");
		assert.strictEqual(preset.provider, "minimax");
		assert.strictEqual(preset.baseUrl, "https://api.minimax.io/v1");
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

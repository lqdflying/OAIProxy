import * as assert from "assert";
import { resolveProviderApiKeyChange } from "../views/configView";

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
});

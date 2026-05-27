import * as assert from "assert";
import { PROVIDER_PRESETS } from "../providerPresets";

suite("providerPresets", () => {
	test("includes Xiaomi MiMo OpenAI-compatible preset", () => {
		const preset = PROVIDER_PRESETS.find((item) => item.id === "mimo");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Xiaomi MiMo");
		assert.strictEqual(preset.provider, "mimo");
		assert.strictEqual(preset.baseUrl, "https://api.xiaomimimo.com/v1");
		assert.strictEqual(preset.apiMode, "openai");
	});
});

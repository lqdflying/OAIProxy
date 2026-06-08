import * as assert from "assert";
import { MODEL_PRESETS } from "../modelPresets";
import { PROVIDER_PRESETS } from "../providerPresets";

suite("modelPresets", () => {
	test("every preset has provider, API mode, base URL, context, and exactly one output token field", () => {
		for (const preset of MODEL_PRESETS) {
			const model = preset.model;
			assert.ok(model.id, `${preset.id} is missing model id`);
			assert.ok(model.owned_by, `${preset.id} is missing provider`);
			assert.ok(model.apiMode, `${preset.id} is missing apiMode`);
			assert.ok(model.baseUrl, `${preset.id} is missing baseUrl`);
			assert.ok(model.context_length && model.context_length > 0, `${preset.id} is missing context_length`);

			const hasMaxTokens = model.max_tokens !== undefined;
			const hasMaxCompletionTokens = model.max_completion_tokens !== undefined;
			assert.notStrictEqual(
				hasMaxTokens,
				hasMaxCompletionTokens,
				`${preset.id} must define exactly one output token field`
			);
		}
	});

	test("references existing provider presets", () => {
		const providerPresetIds = new Set(PROVIDER_PRESETS.map((preset) => preset.id));
		for (const preset of MODEL_PRESETS) {
			assert.ok(providerPresetIds.has(preset.providerPresetId), `${preset.id} references missing provider preset`);
		}
	});

	test("contains the approved MiMo chat presets", () => {
		const mimoIds = MODEL_PRESETS.filter((preset) => preset.model.owned_by === "mimo").map((preset) => preset.model.id);
		assert.deepStrictEqual(mimoIds, ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-flash"]);
	});

	test("uses config IDs to keep duplicate model IDs saveable", () => {
		const fullIds = MODEL_PRESETS.map((preset) => {
			const model = preset.model;
			return `${model.id}${model.configId ? "::" + model.configId : ""}`;
		});
		assert.strictEqual(new Set(fullIds).size, fullIds.length);
	});

	test("enables Anthropic cache control for Anthropic-mode presets", () => {
		const anthropicPresets = MODEL_PRESETS.filter((preset) => preset.model.apiMode === "anthropic");
		assert.ok(anthropicPresets.length > 0, "expected Anthropic-mode presets");

		for (const preset of anthropicPresets) {
			assert.strictEqual(
				preset.model.prompt_cache?.enabled,
				true,
				`${preset.id} should enable prompt cache shaping`
			);
			assert.strictEqual(
				preset.model.prompt_cache?.anthropic?.enabled,
				true,
				`${preset.id} should enable Anthropic cache_control`
			);
		}
	});
});

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

	test("every preset saves an official source note into generated model JSON", () => {
		for (const preset of MODEL_PRESETS) {
			assert.ok(preset.model._comment, `${preset.id} is missing _comment source note`);
			assert.ok(preset.model._comment.includes("https://"), `${preset.id} _comment should include a source URL`);
		}
	});

	test("contains the approved MiMo chat presets", () => {
		const mimoIds = MODEL_PRESETS.filter((preset) => preset.model.owned_by === "mimo").map((preset) => preset.model.id);
		assert.deepStrictEqual(mimoIds, ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-flash"]);
	});

	test("contains LiteLLM Kimi K2.6 quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "litellm-kimi-k2-6");

		assert.ok(preset);
		assert.strictEqual(preset.providerPresetId, "litellm");
		assert.strictEqual(preset.model.id, "Kimi-K2.6");
		assert.strictEqual(preset.model.owned_by, "litellm");
		assert.strictEqual(preset.model.baseUrl, "https://ai.nube.sh/api/v1");
		assert.strictEqual(preset.model.apiMode, "litellm");
		assert.deepStrictEqual(preset.model.extra_body, {
			thinking: {
				type: "enabled",
				keep: "all",
			},
		});
	});

	test("contains LiteLLM GLM-5.1 quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "litellm-glm-5-1");

		assert.ok(preset);
		assert.strictEqual(preset.providerPresetId, "litellm");
		assert.strictEqual(preset.model.id, "GLM-5.1");
		assert.ok(preset.model._comment?.includes("https://docs.z.ai/guides/llm/glm-5.1"));
		assert.strictEqual(preset.model.owned_by, "litellm");
		assert.strictEqual(preset.model.baseUrl, "https://ai.nube.sh/api/v1");
		assert.strictEqual(preset.model.apiMode, "litellm");
		assert.strictEqual(preset.model.context_length, 200000);
		assert.strictEqual(preset.model.max_tokens, 128000);
		assert.deepStrictEqual(preset.model.thinking, {
			type: "enabled",
		});
		assert.strictEqual(preset.model.toolCalling, true);
	});

	test("contains LiteLLM Qwen3.5 122B A10B quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "litellm-qwen3-5-122b-a10b");

		assert.ok(preset);
		assert.strictEqual(preset.providerPresetId, "litellm");
		assert.strictEqual(preset.model.id, "Qwen3.5-122B-A10B");
		assert.ok(preset.model._comment?.includes("https://huggingface.co/Qwen/Qwen3.5-122B-A10B"));
		assert.strictEqual(preset.model.owned_by, "litellm");
		assert.strictEqual(preset.model.baseUrl, "https://ai.nube.sh/api/v1");
		assert.strictEqual(preset.model.apiMode, "litellm");
		assert.strictEqual(preset.model.context_length, 262144);
		assert.strictEqual(preset.model.max_tokens, 32768);
		assert.strictEqual(preset.model.temperature, 0.6);
		assert.strictEqual(preset.model.top_p, 0.95);
		assert.strictEqual(preset.model.presence_penalty, 0.0);
		assert.strictEqual(preset.model.include_reasoning_in_request, true);
		assert.deepStrictEqual(preset.model.extra_body, {
			chat_template_kwargs: {
				enable_thinking: true,
			},
			min_p: 0.0,
			top_k: 20,
			repetition_penalty: 1.0,
		});
		assert.strictEqual(preset.model.vision, true);
		assert.strictEqual(preset.model.toolCalling, true);
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

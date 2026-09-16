import * as assert from "assert";
import { MODEL_PRESETS } from "../modelPresets";
import type { HFModelItem } from "../types";
import {
	getDefaultReasoningEffort,
	getReasoningEffortDescription,
	getReasoningEfforts,
	getRequestedReasoningEffort,
	normalizeReasoningEffortForModel,
	shouldExposeReasoningEffort,
} from "../reasoningEffort";

suite("reasoningEffort", () => {
	test("exposes Anthropic Claude Sonnet 4.6 effort values", () => {
		const claude = model({
			id: "claude-sonnet-4-6",
			owned_by: "anthropic",
			family: "claude-sonnet-4.6",
		});

		assert.strictEqual(shouldExposeReasoningEffort(claude), true);
		assert.deepStrictEqual(getReasoningEfforts(claude), ["low", "medium", "high", "max"]);
		assert.strictEqual(getDefaultReasoningEffort(claude, getReasoningEfforts(claude)), "high");
		assert.strictEqual(normalizeReasoningEffortForModel(claude, "medium"), "medium");
		assert.strictEqual(normalizeReasoningEffortForModel(claude, "xhigh"), undefined);
	});

	test("picks a deterministic default when config omits one", () => {
		const generic = model({
			id: "gpt-5-codex",
			owned_by: "openai",
			supports_reasoning_effort: true,
		});

		assert.strictEqual(getDefaultReasoningEffort(generic, getReasoningEfforts(generic)), "medium");
	});

	test("defaults DeepSeek effort to high when only high and max are exposed", () => {
		const deepseek = model({
			id: "deepseek-v4-pro",
			owned_by: "deepseek",
			supports_reasoning_effort: true,
		});

		assert.deepStrictEqual(getReasoningEfforts(deepseek), ["high", "max"]);
		assert.strictEqual(getDefaultReasoningEffort(deepseek, getReasoningEfforts(deepseek)), "high");
	});

	test("preserves TokenRouter DeepSeek's documented low/high/max tiers", () => {
		const deepseek = model({
			id: "deepseek/deepseek-v4-pro-0813",
			owned_by: "tokenrouter",
			supported_reasoning_efforts: ["low", "high", "max"],
			default_reasoning_effort: "max",
		});

		assert.deepStrictEqual(getReasoningEfforts(deepseek), ["low", "high", "max"]);
		assert.strictEqual(normalizeReasoningEffortForModel(deepseek, "low"), "low");
		assert.strictEqual(normalizeReasoningEffortForModel(deepseek, "high"), "high");
		assert.strictEqual(normalizeReasoningEffortForModel(deepseek, "max"), "max");
		assert.strictEqual(getDefaultReasoningEffort(deepseek, getReasoningEfforts(deepseek)), "max");
	});

	for (const presetId of ["deepseek-flash", "litellm-deepseek-v4-1-flash"]) {
		test(`preserves ${presetId} tiers and normalizes the documented aliases`, () => {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);
			assert.ok(preset);
			const flash = preset.model;
			assert.strictEqual(shouldExposeReasoningEffort(flash), true);
			assert.deepStrictEqual(getReasoningEfforts(flash), ["low", "high", "max"]);
			assert.strictEqual(getDefaultReasoningEffort(flash, getReasoningEfforts(flash)), "max");
			for (const [input, expected] of [
				["minimal", "low"],
				["low", "low"],
				["medium", "high"],
				["high", "high"],
				["xhigh", "high"],
				["max", "max"],
				["ultra", "max"],
				[" low ", "low"],
			]) {
				assert.strictEqual(normalizeReasoningEffortForModel(flash, input), expected, input);
			}
			assert.strictEqual(normalizeReasoningEffortForModel(flash, "invalid"), undefined);
			assert.strictEqual(normalizeReasoningEffortForModel(flash, undefined), undefined);
			assert.deepStrictEqual(getReasoningEfforts(flash, "xhigh"), ["low", "high", "max", "xhigh"]);
		});
	}

	test("retains legacy effort mappings for other DeepSeek presets", () => {
		for (const presetId of ["deepseek-v4-pro", "fireworks-deepseek-v4-pro", "azure-foundry-deepseek-v4-pro"]) {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);
			assert.ok(preset);
			assert.strictEqual(normalizeReasoningEffortForModel(preset.model, "low"), "high", presetId);
			assert.strictEqual(normalizeReasoningEffortForModel(preset.model, "xhigh"), "max", presetId);
		}
	});

	test("retains legacy effort mappings for saved LiteLLM V4 Flash configurations", () => {
		const legacy = model({
			id: "DeepSeek-V4-Flash",
			owned_by: "litellm",
			supported_reasoning_efforts: ["high", "max"],
		});
		assert.strictEqual(normalizeReasoningEffortForModel(legacy, "low"), "high");
		assert.strictEqual(normalizeReasoningEffortForModel(legacy, "xhigh"), "max");
	});

	for (const presetId of ["zai-glm-5-3", "zai-glm-5-3-flash"]) {
		test(`${presetId} exposes only low/high/max with max selected by default`, () => {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);
			assert.ok(preset);
			const glm = preset.model;
			assert.strictEqual(shouldExposeReasoningEffort(glm), true);
			assert.deepStrictEqual(getReasoningEfforts(glm), ["low", "high", "max"]);
			assert.strictEqual(getDefaultReasoningEffort(glm, getReasoningEfforts(glm)), "max");
			for (const effort of ["low", "high", "max"]) {
				assert.strictEqual(normalizeReasoningEffortForModel(glm, effort), effort);
			}
			for (const effort of ["none", "minimal", "medium", "xhigh"]) {
				assert.strictEqual(normalizeReasoningEffortForModel(glm, effort), undefined);
			}
		});
	}

	test("retains configured effort values for saved Z.AI GLM-5.2 models", () => {
		const glm = model({
			id: "glm-5.2",
			owned_by: "zai",
			reasoning_effort: "max",
			supported_reasoning_efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
			default_reasoning_effort: "max",
		});

		assert.strictEqual(shouldExposeReasoningEffort(glm), true);
		assert.deepStrictEqual(getReasoningEfforts(glm), ["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
		assert.strictEqual(getDefaultReasoningEffort(glm, getReasoningEfforts(glm)), "max");
		assert.strictEqual(normalizeReasoningEffortForModel(glm, "none"), "none");
	});

	test("exposes distinct Fireworks GLM-5.2 effort tiers", () => {
		const glm = model({
			id: "accounts/fireworks/models/glm-5p2",
			owned_by: "fireworks",
		});

		assert.strictEqual(shouldExposeReasoningEffort(glm), true);
		assert.deepStrictEqual(getReasoningEfforts(glm), ["none", "high", "max"]);
		assert.strictEqual(getDefaultReasoningEffort(glm, getReasoningEfforts(glm)), "max");
		assert.strictEqual(normalizeReasoningEffortForModel(glm, "none"), "none");
		assert.strictEqual(normalizeReasoningEffortForModel(glm, "medium"), "high");
		assert.strictEqual(normalizeReasoningEffortForModel(glm, "high"), "high");
		assert.strictEqual(normalizeReasoningEffortForModel(glm, "xhigh"), "max");
	});

	test("prefers per-request model options over model configuration", () => {
		assert.strictEqual(getRequestedReasoningEffort({ reasoningEffort: "max" }, { reasoningEffort: "high" }), "high");
		assert.strictEqual(getRequestedReasoningEffort({ reasoning_effort: "max" }, undefined), "max");
		assert.strictEqual(getRequestedReasoningEffort(undefined, { reasoning_effort: "none" }), "none");
	});

	test("preserves configured default effort when valid", () => {
		const deepseek = model({
			id: "deepseek-v4-pro",
			owned_by: "deepseek",
			default_reasoning_effort: "max",
		});

		assert.strictEqual(getDefaultReasoningEffort(deepseek, getReasoningEfforts(deepseek)), "max");
	});

	test("falls back to the first custom effort when medium is unavailable", () => {
		const custom = model({
			id: "custom-reasoning",
			owned_by: "custom",
			supported_reasoning_efforts: ["low", "high"],
		});

		assert.strictEqual(getDefaultReasoningEffort(custom, getReasoningEfforts(custom)), "low");
	});

	test("describes known reasoning effort values", () => {
		assert.strictEqual(getReasoningEffortDescription("medium"), "Balanced reasoning and speed.");
		assert.strictEqual(getReasoningEffortDescription("custom"), "custom");
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

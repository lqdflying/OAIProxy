import * as assert from "assert";
import type { HFModelItem } from "../types";
import {
	getDefaultReasoningEffort,
	getReasoningEffortDescription,
	getReasoningEfforts,
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

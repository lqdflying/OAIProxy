import * as assert from "assert";
import type { HFModelItem } from "../types";
import {
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
		assert.strictEqual(normalizeReasoningEffortForModel(claude, "medium"), "medium");
		assert.strictEqual(normalizeReasoningEffortForModel(claude, "xhigh"), undefined);
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

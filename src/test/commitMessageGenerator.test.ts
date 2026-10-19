import * as assert from "assert";
import { removeThinkTags } from "../gitCommit/commitMessageGenerator";
import { isCommitGenerationCompatibleModel } from "../providerTransport";
import type { HFModelItem } from "../types";

suite("commitMessageGenerator", () => {
	test("removes both standard and DeepSeek thinking tag families", () => {
		assert.strictEqual(
			removeThinkTags(
				"<think>first plan</think>\n<thinking>second plan</thinking>\n<｜begin▁of▁thinking｜>third plan<｜end▁of▁thinking｜>\nfeat: add tests"
			),
			"feat: add tests"
		);
	});

	test("removes unterminated thinking markers without dropping the message", () => {
		assert.strictEqual(
			removeThinkTags("<｜begin▁of▁thinking｜>internal reasoning\nfix: handle errors"),
			"internal reasoning\nfix: handle errors"
		);
	});

	test("excludes OAuth, Gemini, and provider placeholder models from commit generation", () => {
		assert.strictEqual(isCommitGenerationCompatibleModel(model({ id: "gpt-5.5", owned_by: "openai" })), true);
		assert.strictEqual(
			isCommitGenerationCompatibleModel(model({ id: "grok-4", owned_by: "xai", authMode: "oauth" })),
			false
		);
		assert.strictEqual(
			isCommitGenerationCompatibleModel(model({ id: "gemini-3", owned_by: "gemini", apiMode: "gemini" })),
			false
		);
		assert.strictEqual(
			isCommitGenerationCompatibleModel(model({ id: "__provider__openai", owned_by: "openai" })),
			false
		);
		assert.strictEqual(
			isCommitGenerationCompatibleModel(model({ id: "gpt-5.5", owned_by: "proxy" }), [
				{ provider: "proxy", authMode: "oauth" },
			]),
			false
		);
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

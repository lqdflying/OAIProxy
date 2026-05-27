import * as assert from "assert";
import { AnthropicApi } from "../anthropic/anthropicApi";
import type { HFModelItem } from "../types";

suite("anthropicApi", () => {
	test("maps Claude Sonnet 4.6 effort to Anthropic adaptive thinking", () => {
		const api = new AnthropicApi("claude-sonnet-4-6");
		const body = api.prepareRequestBody(
			{
				model: "claude-sonnet-4-6",
				messages: [],
				stream: true,
			},
			model({
				id: "claude-sonnet-4-6",
				owned_by: "anthropic",
				apiMode: "anthropic",
				reasoning_effort: "medium",
			})
		);

		assert.deepStrictEqual(body.output_config, { effort: "medium" });
		assert.deepStrictEqual(body.thinking, { type: "adaptive" });
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

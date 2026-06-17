import * as assert from "assert";
import { OpenaiResponsesApi } from "../openai/openaiResponsesApi";
import type { HFModelItem } from "../types";

suite("openaiResponsesApi", () => {
	test("passes preserved thinking configuration through request body", () => {
		const api = new OpenaiResponsesApi("glm-5.2");
		const body = api.prepareRequestBody(
			{
				model: "glm-5.2",
				input: [],
				stream: true,
			},
			model({
				id: "glm-5.2",
				owned_by: "zai",
				baseUrl: "https://api.z.ai/api/coding/paas/v4",
				apiMode: "openai-responses",
				max_tokens: 131072,
				thinking: {
					type: "enabled",
					clear_thinking: false,
				},
			})
		);

		assert.deepStrictEqual(body.thinking, { type: "enabled", clear_thinking: false });
		assert.strictEqual(body.max_output_tokens, 131072);
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

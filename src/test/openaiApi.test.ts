import * as assert from "assert";
import { OpenaiApi } from "../openai/openaiApi";
import type { HFModelItem } from "../types";

suite("openaiApi", () => {
	test("passes MiMo thinking configuration through request body", () => {
		const api = new OpenaiApi("mimo-v2.5-pro");
		const body = api.prepareRequestBody(
			{
				model: "mimo-v2.5-pro",
				messages: [],
				stream: true,
			},
			model({
				id: "mimo-v2.5-pro",
				owned_by: "mimo",
				baseUrl: "https://api.xiaomimimo.com/v1",
				apiMode: "openai",
				max_completion_tokens: 8192,
				thinking: {
					type: "enabled",
				},
			})
		);

		assert.deepStrictEqual(body.thinking, { type: "enabled" });
		assert.strictEqual(body.max_completion_tokens, 8192);
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

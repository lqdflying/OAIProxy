import * as assert from "assert";
import * as vscode from "vscode";
import { LiteLLMApi } from "../litellm/litellmApi";
import { getLatestCacheUsage, resetCacheUsageForTests } from "../cacheUsage";
import type { HFModelItem } from "../types";

suite("litellmApi", () => {
	setup(() => {
		resetCacheUsageForTests();
	});

	test("maps thinking configuration into extra_body", () => {
		const body = prepare({
			thinking: {
				type: "enabled",
				clear_thinking: false,
			},
			thinking_budget: 4096,
		});

		assert.deepStrictEqual(body.extra_body, {
			thinking: {
				type: "enabled",
				budget_tokens: 4096,
				clear_thinking: false,
			},
		});
		assert.strictEqual(body.thinking, undefined);
		assert.strictEqual(body.thinking_budget, undefined);
	});

	test("maps enable_thinking fallback into extra_body", () => {
		const body = prepare({
			enable_thinking: false,
		});

		assert.deepStrictEqual(body.extra_body, {
			thinking: {
				type: "disabled",
			},
		});
		assert.strictEqual(body.enable_thinking, undefined);
	});

	test("puts OpenRouter reasoning configuration into extra_body", () => {
		const body = prepare({
			reasoning: {
				effort: "high",
				exclude: true,
			},
		});

		assert.deepStrictEqual(body.extra_body, {
			reasoning: {
				effort: "high",
				exclude: true,
			},
		});
		assert.strictEqual(body.reasoning, undefined);
	});

	test("merges explicit extra_body last while preserving top-level extra", () => {
		const body = prepare({
			max_tokens: 2000,
			thinking: {
				type: "enabled",
			},
			extra: {
				user: "trace-user",
				extra_body: {
					metadata: {
						tags: ["from-extra"],
					},
					thinking: {
						keep: "all",
					},
				},
			},
			extra_body: {
				thinking: {
					type: "disabled",
				},
				allowed_openai_params: ["tools"],
			},
		});

		assert.strictEqual(body.max_tokens, 2000);
		assert.strictEqual(body.user, "trace-user");
		assert.deepStrictEqual(body.extra_body, {
			metadata: {
				tags: ["from-extra"],
			},
			thinking: {
				type: "disabled",
				keep: "all",
			},
			allowed_openai_params: ["tools"],
		});
	});

	test("records cache usage with LiteLLM API mode label", async () => {
		const api = new LiteLLMApi("litellm-cache-test");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"prompt_tokens_details\":{\"cached_tokens\":80}}}",
							"",
							"data: [DONE]",
							"",
						].join("\n")
					)
				);
				controller.close();
			},
		});

		await api.processStreamingResponse(
			stream,
			{
				report() {},
			},
			{
				isCancellationRequested: false,
				onCancellationRequested: () => ({ dispose() {} }),
			} as unknown as vscode.CancellationToken
		);

		const latest = getLatestCacheUsage("litellm-cache-test");
		assert.strictEqual(latest?.apiMode, "litellm");
		assert.strictEqual(latest?.cacheHitTokens, 80);
	});
});

function prepare(overrides: Partial<HFModelItem>): Record<string, unknown> {
	const api = new LiteLLMApi("model");
	return api.prepareRequestBody(
		{
			model: "model",
			messages: [],
			stream: true,
			stream_options: { include_usage: true },
		},
		model(overrides)
	);
}

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "litellm",
		apiMode: "litellm",
		...overrides,
	};
}

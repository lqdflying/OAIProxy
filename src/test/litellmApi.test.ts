import * as assert from "assert";
import * as vscode from "vscode";
import { LiteLLMApi } from "../litellm/litellmApi";
import { getLatestCacheUsage, resetCacheUsageForTests } from "../cacheUsage";
import { COPILOT_USAGE_MIME } from "../responseUsage";
import type { HFModelItem } from "../types";
import { MODEL_PRESETS } from "../modelPresets";

suite("litellmApi", () => {
	setup(() => {
		resetCacheUsageForTests();
	});

	test("prepares current LiteLLM presets with reasoning and required tools", () => {
		for (const [presetId, thinking] of [
			["litellm-glm-5-3-flash", undefined],
			["litellm-glm-5-3", undefined],
			["litellm-deepseek-v4-1-flash", { type: "enabled" }],
			["litellm-qwen3-8-27b", undefined],
		] as const) {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);
			assert.ok(preset);
			const api = new LiteLLMApi(preset.model.id);
			const body = api.prepareRequestBody(
				{ model: preset.model.id, messages: [], stream: true, stream_options: { include_usage: true } },
				preset.model,
				{
					requestInitiator: "test",
					toolMode: vscode.LanguageModelChatToolMode.Required,
					tools: [{ name: "echo", description: "Echo a value", inputSchema: { type: "object" } }],
				}
			);
			assert.strictEqual(body.model, preset.model.id);
			assert.strictEqual(body.max_tokens, preset.model.max_tokens);
			assert.strictEqual(body.max_completion_tokens, undefined);
			assert.strictEqual(body.reasoning_effort, presetId === "litellm-qwen3-8-27b" ? "xhigh" : "max");
			assert.strictEqual(body.thinking, undefined);
			assert.strictEqual(body.enable_thinking, undefined);
			assert.deepStrictEqual(body.extra_body, thinking ? { thinking } : undefined);
			assert.deepStrictEqual(body.stream_options, { include_usage: true });
			assert.deepStrictEqual(body.tool_choice, { type: "function", function: { name: "echo" } });
			assert.deepStrictEqual(body.tools, [
				{ type: "function", function: { name: "echo", description: "Echo a value", parameters: { type: "object" } } },
			]);
		}
	});

	test("strips legacy GLM thinking fields before named tool calls", () => {
		const body = prepare({
			id: "GLM-5.3-Flash",
			thinking: { type: "enabled", clear_thinking: false },
			extra: {
				thinking: { type: "enabled" },
				extra_body: { thinking: { type: "enabled", clear_thinking: false }, metadata: { source: "legacy" } },
			},
			extra_body: { thinking: { type: "enabled" }, allowed_openai_params: ["tools"] },
		});

		assert.strictEqual(body.thinking, undefined);
		assert.deepStrictEqual(body.extra_body, {
			metadata: { source: "legacy" },
			allowed_openai_params: ["tools"],
		});
	});

	test("preserves empty DeepSeek reasoning fields in thinking tool history", () => {
		const body = new LiteLLMApi("DeepSeek-V4.1-Flash").prepareRequestBody(
			{
				model: "DeepSeek-V4.1-Flash",
				messages: [
					{ role: "assistant", tool_calls: [{ id: "call-1", type: "function", function: { name: "echo", arguments: "{}" } }] },
					{ role: "assistant", content: "Visible answer." },
				],
				stream: true,
			},
			{
				...model({
					id: "DeepSeek-V4.1-Flash",
					thinking: { type: "enabled" },
				}),
				max_tokens: 1024,
			},
			{
				requestInitiator: "test",
				toolMode: vscode.LanguageModelChatToolMode.Auto,
				tools: [{ name: "echo", description: "Echo a value", inputSchema: { type: "object" } }],
			}
		);

		assert.deepStrictEqual(body.extra_body, { thinking: { type: "enabled" } });
		assert.deepStrictEqual(body.messages, [
			{
				role: "assistant",
				tool_calls: [{ id: "call-1", type: "function", function: { name: "echo", arguments: "{}" } }],
				reasoning_content: "",
				content: "",
			},
			{ role: "assistant", content: "Visible answer.", reasoning_content: "" },
		]);
	});

	test("does not add DeepSeek compatibility fields when thinking is disabled", () => {
		const body = new LiteLLMApi("DeepSeek-V4.1-Flash").prepareRequestBody(
			{
				model: "DeepSeek-V4.1-Flash",
				messages: [{ role: "assistant", tool_calls: [{ id: "call-1" }] }],
				stream: true,
			},
			{
				...model({ id: "DeepSeek-V4.1-Flash", thinking: { type: "disabled" } }),
				max_tokens: 1024,
			},
			{
				requestInitiator: "test",
				toolMode: vscode.LanguageModelChatToolMode.Auto,
				tools: [{ name: "echo", description: "Echo a value", inputSchema: { type: "object" } }],
			}
		);

		assert.deepStrictEqual(body.messages, [{ role: "assistant", tool_calls: [{ id: "call-1" }] }]);
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
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}],\"usage\":{\"prompt_tokens\":90,\"completion_tokens\":4,\"total_tokens\":94}}",
							"",
							"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":5,\"total_tokens\":105,\"prompt_tokens_details\":{\"cached_tokens\":80}}}",
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
				report(part) {
					parts.push(part);
				},
			},
			{
				isCancellationRequested: false,
				onCancellationRequested: () => ({ dispose() {} }),
			} as unknown as vscode.CancellationToken
		);

		const latest = getLatestCacheUsage("litellm-cache-test");
		assert.strictEqual(latest?.apiMode, "litellm");
		assert.strictEqual(latest?.cacheHitTokens, 80);

		const usageParts = parts.filter(
			(part): part is vscode.LanguageModelDataPart =>
				part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME
		);
		assert.strictEqual(usageParts.length, 1);
		assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(usageParts[0].data)), {
			prompt_tokens: 100,
			completion_tokens: 5,
			total_tokens: 105,
			prompt_tokens_details: { cached_tokens: 80 },
		});
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

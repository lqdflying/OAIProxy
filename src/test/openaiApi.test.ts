import * as assert from "assert";
import * as vscode from "vscode";
import { CommonApi } from "../commonApi";
import { MODEL_PRESETS } from "../modelPresets";
import { OpenaiApi } from "../openai/openaiApi";
import { getRequestedReasoningEffort, normalizeReasoningEffortForModel } from "../reasoningEffort";
import { COPILOT_USAGE_MIME } from "../responseUsage";
import type { HFModelItem } from "../types";

suite("openaiApi", () => {
	test("sends DeepSeek Flash limits, thinking, and normalized per-request effort", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "deepseek-flash");
		assert.ok(preset);
		const api = new OpenaiApi(preset.model.id);
		for (const selected of [undefined, "low", "high", "max"]) {
			const effort = normalizeReasoningEffortForModel(
				preset.model,
				getRequestedReasoningEffort({ reasoningEffort: "max" }, selected ? { reasoningEffort: selected } : undefined)
			);
			const body = api.prepareRequestBody(
				{ model: preset.model.id, messages: [], stream: true },
				{ ...preset.model, reasoning_effort: effort }
			);
			assert.strictEqual(body.model, "deepseek-flash");
			assert.strictEqual(body.max_tokens, 393216);
			assert.strictEqual(body.max_completion_tokens, undefined);
			assert.strictEqual(body.reasoning_effort, selected ?? "max");
			assert.deepStrictEqual(body.thinking, { type: "enabled" });
			assert.strictEqual(body.prompt_cache_key, undefined);
			assert.strictEqual(body.prompt_cache_retention, undefined);
		}
		assert.strictEqual(preset.model.reasoning_effort, "max");
	});

	test("uses the Azure Foundry api-key header without bearer authorization", () => {
		const headers = CommonApi.prepareHeaders("foundry-secret", "azure-foundry");

		assert.strictEqual(headers["api-key"], "foundry-secret");
		assert.strictEqual(headers.Authorization, undefined);
		assert.strictEqual(headers["Content-Type"], "application/json");
	});

	test("keeps direct Azure Foundry request bodies free of rejected cache and thinking fields", () => {
		for (const presetId of ["azure-foundry-kimi-k2-6", "azure-foundry-deepseek-v4-pro"]) {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);
			assert.ok(preset);
			const body = new OpenaiApi(preset.model.id, "azure-foundry").prepareRequestBody(
				{
					model: preset.model.id,
					messages: [],
					stream: true,
				},
				preset.model
			);

			assert.strictEqual(body.reasoning_effort, preset.model.reasoning_effort);
			assert.strictEqual(body.thinking, undefined);
			assert.strictEqual(body.prompt_cache_key, undefined);
			assert.strictEqual(body.prompt_cache_retention, undefined);
		}
	});

	test("passes MiniMax M3 OpenAI thinking configuration through request body", () => {
		const api = new OpenaiApi("MiniMax-M3");
		const body = api.prepareRequestBody(
			{
				model: "MiniMax-M3",
				messages: [],
				stream: true,
			},
			model({
				id: "MiniMax-M3",
				owned_by: "minimax",
				baseUrl: "https://api.minimax.io/v1",
				apiMode: "openai",
				max_completion_tokens: 131072,
				thinking: {
					type: "adaptive",
				},
				extra: {
					reasoning_split: true,
				},
			})
		);

		assert.deepStrictEqual(body.thinking, { type: "adaptive" });
		assert.strictEqual(body.reasoning_split, true);
		assert.strictEqual(body.max_completion_tokens, 131072);
	});

	test("maps MiniMax M3 video data parts to OpenAI video_url content", () => {
		const api = new OpenaiApi("MiniMax-M3");
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.User,
					name: undefined,
					content: [
						new vscode.LanguageModelTextPart("Describe this clip."),
						new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "video/mp4"),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false }
		);

		const content = messages[0].content as unknown as Array<Record<string, unknown>>;
		assert.strictEqual(messages[0].role, "user");
		assert.deepStrictEqual(content[0], {
			type: "text",
			text: "Describe this clip.",
		});
		assert.deepStrictEqual(content[1], {
			type: "video_url",
			video_url: {
				url: "data:video/mp4;base64,AQID",
			},
		});
	});

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

	for (const presetId of ["zai-glm-5-3", "zai-glm-5-3-flash"]) {
		test(`${presetId} sends preserved thinking and streaming tool controls`, () => {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);
			assert.ok(preset);
			const body = new OpenaiApi(preset.model.id).prepareRequestBody(
				{ model: preset.model.id, messages: [], stream: true },
				preset.model
			);
			assert.strictEqual(body.model, presetId === "zai-glm-5-3" ? "glm-5.3" : "glm-5.3-flash");
			assert.strictEqual(body.max_tokens, 131072);
			assert.strictEqual(body.max_completion_tokens, undefined);
			assert.strictEqual(body.reasoning_effort, "max");
			assert.deepStrictEqual(body.thinking, { type: "enabled", clear_thinking: false });
			assert.strictEqual(body.temperature, 1);
			assert.strictEqual(body.top_p, 0.95);
			assert.strictEqual(body.stream, true);
			assert.strictEqual(body.tool_stream, true);
			assert.strictEqual(body.extra, undefined);
			assert.strictEqual(body.prompt_cache_key, undefined);
			assert.strictEqual(body.prompt_cache_retention, undefined);
		});
	}

	test("passes saved Z.AI GLM-5.2 preserved thinking configuration through request body", () => {
		const api = new OpenaiApi("glm-5.2");
		const body = api.prepareRequestBody(
			{
				model: "glm-5.2",
				messages: [],
				stream: true,
			},
			model({
				id: "glm-5.2",
				owned_by: "zai",
				baseUrl: "https://api.z.ai/api/coding/paas/v4",
				apiMode: "openai",
				max_tokens: 131072,
				reasoning_effort: "max",
				thinking: {
					type: "enabled",
					clear_thinking: false,
				},
			})
		);

		assert.deepStrictEqual(body.thinking, { type: "enabled", clear_thinking: false });
		assert.strictEqual(body.max_tokens, 131072);
		assert.strictEqual(body.reasoning_effort, "max");
	});

	test("does not invent preserved reasoning content for assistant history", () => {
		const api = new OpenaiApi("glm-5.2");
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [new vscode.LanguageModelTextPart("Visible answer.")],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: true }
		);

		assert.strictEqual(messages.length, 1);
		assert.strictEqual(messages[0].role, "assistant");
		assert.strictEqual(messages[0].content, "Visible answer.");
		assert.strictEqual(messages[0].reasoning_content, undefined);
	});

	test("uses Kimi K3 request controls and preserves assistant reasoning", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "kimi-k3");
		assert.ok(preset);

		const api = new OpenaiApi("kimi-k3");
		const body = api.prepareRequestBody(
			{
				model: preset.model.id,
				messages: [],
				stream: true,
			},
			preset.model
		);
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [
						new vscode.LanguageModelThinkingPart("Preserved reasoning."),
						new vscode.LanguageModelTextPart("Visible answer."),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: preset.model.include_reasoning_in_request === true }
		);

		assert.strictEqual(body.max_completion_tokens, 131072);
		assert.strictEqual(body.max_tokens, undefined);
		assert.strictEqual(body.reasoning_effort, "max");
		assert.strictEqual(body.thinking, undefined);
		assert.strictEqual(body.temperature, undefined);
		assert.strictEqual(body.top_p, undefined);
		assert.strictEqual(messages.length, 1);
		assert.strictEqual(messages[0].role, "assistant");
		assert.strictEqual(messages[0].content, "Visible answer.");
		assert.strictEqual(messages[0].reasoning_content, "Preserved reasoning.");
	});

	test("uses exact TokenRouter model IDs and documented request controls", () => {
		const expected = new Map([
			[
				"deepseek/deepseek-v4-pro-0813",
				{ maxTokens: 393216, maxCompletionTokens: undefined, effort: "max", thinking: { type: "enabled" } },
			],
			["qwen/qwen3.8-max", { maxTokens: undefined, maxCompletionTokens: 65536, effort: "xhigh", thinking: undefined }],
			["moonshotai/kimi-k3", { maxTokens: undefined, maxCompletionTokens: 131072, effort: "max", thinking: undefined }],
			[
				"z-ai/glm-5.3",
				{
					maxTokens: 131072,
					maxCompletionTokens: undefined,
					effort: "max",
					thinking: { type: "enabled", clear_thinking: false },
				},
			],
		]);

		for (const preset of MODEL_PRESETS.filter((item) => item.providerPresetId === "tokenrouter")) {
			const controls = expected.get(preset.model.id);
			assert.ok(controls, `unexpected TokenRouter model ${preset.model.id}`);
			const api = new OpenaiApi(preset.model.id);
			const body = api.prepareRequestBody(
				{
					model: preset.model.id,
					messages: [],
					stream: true,
				},
				preset.model
			);

			assert.strictEqual(body.model, preset.model.id);
			assert.strictEqual(body.max_tokens, controls.maxTokens);
			assert.strictEqual(body.max_completion_tokens, controls.maxCompletionTokens);
			assert.strictEqual(body.reasoning_effort, controls.effort);
			assert.deepStrictEqual(body.thinking, controls.thinking);
		}
	});

	test("keeps Kimi K2.7 Code request body on official defaults", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "kimi-k2-7-code");
		assert.ok(preset);

		const api = new OpenaiApi("kimi-k2.7-code");
		const body = api.prepareRequestBody(
			{
				model: preset.model.id,
				messages: [],
				stream: true,
			},
			preset.model
		);

		assert.strictEqual(body.max_completion_tokens, 32768);
		assert.strictEqual(body.max_tokens, undefined);
		assert.strictEqual(body.thinking, undefined);
		assert.strictEqual(body.temperature, undefined);
		assert.strictEqual(body.top_p, undefined);
	});

	test("preserves documented Fireworks request controls", () => {
		const presets = MODEL_PRESETS.filter((item) => item.model.owned_by === "fireworks");
		assert.strictEqual(presets.length, 3);

		for (const preset of presets) {
			const api = new OpenaiApi(preset.model.id);
			const body = api.prepareRequestBody(
				{
					model: preset.model.id,
					messages: [],
					stream: true,
				},
				preset.model
			);

			assert.strictEqual(body.max_tokens, preset.model.max_tokens);
			assert.strictEqual(body.max_completion_tokens, undefined);
			assert.strictEqual(body.reasoning_effort, preset.model.reasoning_effort);
			assert.strictEqual(body.thinking, undefined);
		}
	});

	test("extracts LiteLLM provider-specific reasoning content from stream", async () => {
		const api = new OpenaiApi("litellm-model");
		const parts: unknown[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							'data: {"choices":[{"delta":{"provider_specific_fields":{"reasoning_content":"thinking..."}}}]}',
							"",
							'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}',
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

		assert.ok(parts.some((part) => (part as { value?: unknown }).value === "thinking..."));
		assert.ok(parts.some((part) => (part as { value?: unknown }).value === "answer"));
	});

	test("emits final message content from OpenAI-compatible stream chunks", async () => {
		const api = new OpenaiApi("final-message-model");
		const parts: unknown[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							'data: {"choices":[{"message":{"role":"assistant","content":"final answer"},"finish_reason":"stop"}]}',
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

		assert.ok(parts.some((part) => (part as { value?: unknown }).value === "final answer"));
	});

	test("emits final message tool calls from OpenAI-compatible stream chunks", async () => {
		const api = new OpenaiApi("final-tool-model");
		const parts: unknown[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							'data: {"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
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

		assert.ok(
			parts.some((part) => {
				const toolCall = part as { callId?: unknown; name?: unknown; input?: unknown };
				return toolCall.callId === "call_1" && toolCall.name === "read_file";
			})
		);
	});

	test("does not emit collected usage after cancellation", async () => {
		const api = new OpenaiApi("cancelled-usage-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105}}',
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
					if (part instanceof vscode.LanguageModelTextPart && part.value === "answer") {
						cancelled = true;
					}
				},
			},
			{
				get isCancellationRequested() {
					return cancelled;
				},
				onCancellationRequested: () => ({ dispose() {} }),
			} as unknown as vscode.CancellationToken
		);

		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelTextPart && part.value === "answer"));
		assert.ok(
			!parts.some((part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME)
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

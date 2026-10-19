import * as assert from "assert";
import * as vscode from "vscode";
import { OpenaiResponsesApi } from "../openai/openaiResponsesApi";
import { MODEL_PRESETS } from "../modelPresets";
import { COPILOT_USAGE_MIME } from "../responseUsage";
import type { HFModelItem } from "../types";

suite("openaiResponsesApi", () => {
	test("sends GPT-6.1 Sol API-key xhigh effort with detailed summaries and the output cap", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "openai-gpt-6-1-sol-responses");
		assert.ok(preset);
		const api = new OpenaiResponsesApi(preset.model.id);
		const body = api.prepareRequestBody({ model: preset.model.id, input: [], stream: true }, preset.model);

		assert.strictEqual(body.model, "gpt-6.1-sol");
		assert.deepStrictEqual(body.reasoning, { effort: "xhigh", summary: "detailed" });
		assert.strictEqual(body.max_output_tokens, 128000);
		assert.strictEqual(body.store, undefined);
	});

	test("sends GPT-6.1 Sol OAuth xhigh effort while retaining the Codex body restrictions", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "openai-gpt-6-1-sol-codex-oauth");
		assert.ok(preset);
		const api = new OpenaiResponsesApi(preset.model.id);
		const body = api.prepareRequestBody({ model: preset.model.id, input: [], stream: true }, preset.model);

		assert.strictEqual(body.model, "gpt-6.1-sol");
		assert.deepStrictEqual(body.reasoning, { effort: "xhigh" });
		assert.strictEqual(body.store, false);
		assert.deepStrictEqual(body.include, ["reasoning.encrypted_content"]);
		assert.strictEqual(body.max_output_tokens, undefined);
	});

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

	test("serializes replayed Responses items deterministically", () => {
		const api = new OpenaiResponsesApi("gpt-6-astra");
		const messages = [
			{
				role: vscode.LanguageModelChatMessageRole.Assistant,
				name: undefined,
				content: [
					new vscode.LanguageModelTextPart("assistant reply"),
					new vscode.LanguageModelToolCallPart("", "read_file", { path: "README.md" }),
				],
			},
			{
				role: vscode.LanguageModelChatMessageRole.User,
				name: undefined,
				content: [{ callId: "call_0_1", content: [new vscode.LanguageModelTextPart("tool result")] }],
			},
		] as unknown as vscode.LanguageModelChatRequestMessage[];

		const first = api.convertMessages(messages, { includeReasoningInRequest: false });
		const second = api.convertMessages(messages, { includeReasoningInRequest: false });

		assert.deepStrictEqual(second, first);
	});

	test("uses ChatHub-compatible easy input for Codex OAuth replays", () => {
		const api = new OpenaiResponsesApi("gpt-6-astra");
		const messages = [
			{
				role: vscode.LanguageModelChatMessageRole.Assistant,
				name: undefined,
				content: [
					new vscode.LanguageModelTextPart("assistant reply"),
					new vscode.LanguageModelToolCallPart("call_0_1", "read_file", { path: "README.md" }),
				],
			},
			{
				role: vscode.LanguageModelChatMessageRole.User,
				name: undefined,
				content: [{ callId: "call_0_1", content: [new vscode.LanguageModelTextPart("tool result")] }],
			},
		] as unknown as vscode.LanguageModelChatRequestMessage[];

		const items = api.convertMessages(
			messages,
			{ includeReasoningInRequest: false },
			{
				replayResponsesItemIds: false,
				codexEasyInput: true,
			}
		);

		assert.ok(items.length > 0);
		assert.deepStrictEqual(items[0], { role: "assistant", content: "assistant reply" });
		assert.deepStrictEqual(items[1], {
			type: "function_call",
			call_id: "call_0_1",
			name: "read_file",
			arguments: JSON.stringify({ path: "README.md" }),
		});
		assert.deepStrictEqual(items[2], {
			type: "function_call_output",
			call_id: "call_0_1",
			output: "tool result",
		});
	});

	test("disables response storage for OpenAI Codex OAuth", () => {
		const api = new OpenaiResponsesApi("gpt-6-astra");
		const body = api.prepareRequestBody(
			{
				model: "gpt-6-astra",
				input: [],
				stream: true,
			},
			model({
				id: "gpt-6-astra",
				owned_by: "openai-oauth",
				authMode: "oauth",
				baseUrl: "https://chatgpt.com/backend-api/codex",
				apiMode: "openai-responses",
				max_tokens: 128000,
				temperature: 0.2,
				top_p: 0.9,
				extra: {
					store: true,
					metadata: { source: "test" },
					context_management: { compact_threshold: 0.8 },
					prompt_cache_retention: "24h",
				},
			})
		);

		assert.strictEqual(body.store, false);
		assert.deepStrictEqual(body.include, ["reasoning.encrypted_content"]);
		assert.strictEqual(body.max_output_tokens, undefined);
		assert.strictEqual(body.temperature, undefined);
		assert.strictEqual(body.top_p, undefined);
		assert.strictEqual(body.metadata, undefined);
		assert.strictEqual(body.context_management, undefined);
		assert.strictEqual(body.prompt_cache_retention, undefined);
	});

	test("does not force storage for normal OpenAI API-key Responses", () => {
		const api = new OpenaiResponsesApi("gpt-6-astra");
		const body = api.prepareRequestBody(
			{ model: "gpt-6-astra", input: [], stream: true },
			model({
				id: "gpt-6-astra",
				owned_by: "openai",
				baseUrl: "https://api.openai.com/v1",
				apiMode: "openai-responses",
			})
		);

		assert.strictEqual(body.store, undefined);
	});

	test("emits nested response usage after a completed stream", async () => {
		const api = new OpenaiResponsesApi("responses-usage-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"usage\":{\"input_tokens\":700,\"output_tokens\":50,\"total_tokens\":750,\"input_tokens_details\":{\"cached_tokens\":500},\"output_tokens_details\":{\"reasoning_tokens\":30}}}}",
							"",
							"data: [DONE]",
							"",
						].join("\n")
					)
				);
				controller.close();
			},
		});

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		const usagePart = parts.find(
			(part): part is vscode.LanguageModelDataPart =>
				part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME
		);
		assert.ok(usagePart);
		assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(usagePart.data)), {
			prompt_tokens: 700,
			completion_tokens: 50,
			total_tokens: 750,
			prompt_tokens_details: { cached_tokens: 500 },
			completion_tokens_details: { reasoning_tokens: 30 },
		});
	});

	test("preserves provider messages from failed response streams without emitting usage", async () => {
		const cases = [
			{
				label: "top-level error event",
				payload: { type: "error", code: "rate_limit_exceeded", message: "Too many requests" },
				expected: "rate_limit_exceeded: Too many requests",
			},
			{
				label: "response.failed event",
				payload: {
					type: "response.failed",
					response: {
						error: { code: "invalid_request_error", message: "The prompt is invalid" },
						usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
					},
				},
				expected: "invalid_request_error: The prompt is invalid",
			},
			{
				label: "response.cancelled event",
				payload: {
					type: "response.cancelled",
					response: {
						error: { code: "cancelled", message: "The provider cancelled the response" },
						usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
					},
				},
				expected: "cancelled: The provider cancelled the response",
			},
		];

		for (const testCase of cases) {
			const api = new OpenaiResponsesApi("failed-responses-model");
			const parts: vscode.LanguageModelResponsePart2[] = [];
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							[
								`data: ${JSON.stringify(testCase.payload)}`,
								"",
								"data: [DONE]",
								"",
							].join("\n")
						)
					);
					controller.close();
				},
			});

			await assert.rejects(
				api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken()),
				new RegExp(testCase.expected),
				testCase.label
			);

			assert.ok(
				!parts.some(
					(part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME
				),
				testCase.label
			);
			assert.strictEqual(api.responseId, null, `${testCase.label} must not be retained as resumable state`);
		}
	});

	test("processes a final response event that has no trailing newline", async () => {
		const api = new OpenaiResponsesApi("buffered-responses-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'data: {"type":"response.output_text.delta","delta":"final response text"}'
					)
				);
				controller.close();
			},
		});

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.ok(
			parts.some(
				(part) => part instanceof vscode.LanguageModelTextPart && part.value === "final response text"
			)
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

function cancellationToken(): vscode.CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	} as unknown as vscode.CancellationToken;
}

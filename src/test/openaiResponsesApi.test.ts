import * as assert from "assert";
import * as vscode from "vscode";
import { OpenaiResponsesApi } from "../openai/openaiResponsesApi";
import { COPILOT_USAGE_MIME } from "../responseUsage";
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

	test("does not emit usage for a failed response stream", async () => {
		const api = new OpenaiResponsesApi("failed-responses-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"type\":\"response.failed\",\"response\":{\"usage\":{\"input_tokens\":100,\"output_tokens\":5,\"total_tokens\":105}}}",
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

		assert.ok(
			!parts.some(
				(part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME
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

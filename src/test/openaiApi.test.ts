import * as assert from "assert";
import * as vscode from "vscode";
import { MODEL_PRESETS } from "../modelPresets";
import { OpenaiApi } from "../openai/openaiApi";
import type { HFModelItem } from "../types";

suite("openaiApi", () => {
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

	test("extracts LiteLLM provider-specific reasoning content from stream", async () => {
		const api = new OpenaiApi("litellm-model");
		const parts: unknown[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"choices\":[{\"delta\":{\"provider_specific_fields\":{\"reasoning_content\":\"thinking...\"}}}]}",
							"",
							"data: {\"choices\":[{\"delta\":{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}",
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
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

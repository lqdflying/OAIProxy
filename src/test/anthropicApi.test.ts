import * as assert from "assert";
import * as vscode from "vscode";
import { AnthropicApi } from "../anthropic/anthropicApi";
import { COPILOT_USAGE_MIME } from "../responseUsage";
import type { HFModelItem } from "../types";

suite("anthropicApi", () => {
	function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(lines.join("\n")));
				controller.close();
			},
		});
	}

	test("maps MiniMax M3 video data parts to Anthropic video blocks", () => {
		const api = new AnthropicApi("MiniMax-M3");
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
			type: "video",
			source: {
				type: "base64",
				media_type: "video/mp4",
				data: "AQID",
			},
		});
	});

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

	test("merges start and delta usage before emitting one final part", async () => {
		const api = new AnthropicApi("claude-usage-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"claude-usage-model\",\"usage\":{\"input_tokens\":50,\"output_tokens\":1,\"cache_read_input_tokens\":100000,\"cache_creation_input_tokens\":20}}}",
							"",
							"data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}",
							"",
							"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":75}}",
							"",
							"data: {\"type\":\"message_stop\"}",
							"",
						].join("\n")
					)
				);
				controller.close();
			},
		});

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelTextPart && part.value === "answer"));
		const usageParts = parts.filter(
			(part): part is vscode.LanguageModelDataPart =>
				part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME
		);
		assert.strictEqual(usageParts.length, 1);
		assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(usageParts[0].data)), {
			prompt_tokens: 100070,
			completion_tokens: 75,
			total_tokens: 100145,
			prompt_tokens_details: { cached_tokens: 100000 },
			cache_creation_input_tokens: 20,
		});
	});

	test("replays signed thinking before assistant text", () => {
		const api = new AnthropicApi("claude-thinking-model");
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [
						new vscode.LanguageModelTextPart("answer"),
						new vscode.LanguageModelThinkingPart("reasoning", "thinking-1", { signature: "sig-1" }),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: true }
		);

		assert.deepStrictEqual(messages[0].content, [
			{ type: "thinking", thinking: "reasoning", signature: "sig-1" },
			{ type: "text", text: "answer" },
		]);
	});

	test("replays redacted thinking and never fabricates missing thinking", () => {
		const api = new AnthropicApi("claude-thinking-model");
		const [redacted, plain] = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [
						new vscode.LanguageModelThinkingPart("", "thinking-redacted", { redactedThinking: "opaque-data" }),
						new vscode.LanguageModelTextPart("redacted answer"),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [new vscode.LanguageModelTextPart("plain answer")],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: true }
		);

		assert.deepStrictEqual(redacted.content, [
			{ type: "redacted_thinking", data: "opaque-data" },
			{ type: "text", text: "redacted answer" },
		]);
		assert.deepStrictEqual(plain.content, [{ type: "text", text: "plain answer" }]);
	});

	test("replays signed thinking for manual thinking tool continuations when the replay flag is off", () => {
		const api = new AnthropicApi("claude-thinking-model");
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [
						new vscode.LanguageModelThinkingPart("reasoning", "thinking-1", { signature: "sig-1" }),
						new vscode.LanguageModelTextPart("Using a tool."),
						new vscode.LanguageModelToolCallPart("call-1", "read_file", { path: "README.md" }),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false },
			model({
				id: "claude-thinking-model",
				apiMode: "anthropic",
				thinking: { type: "enabled" },
				thinking_budget: 1024,
				max_tokens: 8192,
			})
		);

		assert.deepStrictEqual(messages[0].content, [
			{ type: "thinking", thinking: "reasoning", signature: "sig-1" },
			{ type: "text", text: "Using a tool." },
			{
				type: "tool_use",
				id: "call-1",
				name: "read_file",
				input: { path: "README.md" },
			},
		]);
	});

	test("replays signed thinking when extra enables manual thinking", () => {
		const api = new AnthropicApi("claude-extra-thinking-model");
		const extraThinkingModel = model({
			id: "claude-extra-thinking-model",
			apiMode: "anthropic",
			max_tokens: 8192,
			extra: { thinking: { type: "enabled", budget_tokens: 1024 } },
		});
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [
						new vscode.LanguageModelThinkingPart("reasoning", "thinking-1", { signature: "sig-1" }),
						new vscode.LanguageModelTextPart("Using a tool."),
						new vscode.LanguageModelToolCallPart("call-1", "read_file", { path: "README.md" }),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false },
			extraThinkingModel
		);
		const body = api.prepareRequestBody(
			{ model: "claude-extra-thinking-model", messages, stream: true },
			extraThinkingModel
		);

		assert.deepStrictEqual(messages[0].content, [
			{ type: "thinking", thinking: "reasoning", signature: "sig-1" },
			{ type: "text", text: "Using a tool." },
			{
				type: "tool_use",
				id: "call-1",
				name: "read_file",
				input: { path: "README.md" },
			},
		]);
		assert.deepStrictEqual(body.thinking, { type: "enabled", budget_tokens: 1024 });
	});

	test("does not replay signed thinking when extra disables manual thinking", () => {
		const api = new AnthropicApi("claude-extra-thinking-disabled-model");
		const extraThinkingDisabledModel = model({
			id: "claude-extra-thinking-disabled-model",
			apiMode: "anthropic",
			thinking: { type: "enabled" },
			thinking_budget: 1024,
			max_tokens: 8192,
			extra: { thinking: { type: "disabled" } },
		});
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [
						new vscode.LanguageModelThinkingPart("reasoning", "thinking-1", { signature: "sig-1" }),
						new vscode.LanguageModelTextPart("Using a tool."),
						new vscode.LanguageModelToolCallPart("call-1", "read_file", { path: "README.md" }),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false },
			extraThinkingDisabledModel
		);
		const body = api.prepareRequestBody(
			{ model: "claude-extra-thinking-disabled-model", messages, stream: true },
			extraThinkingDisabledModel
		);

		assert.deepStrictEqual(messages[0].content, [
			{ type: "text", text: "Using a tool." },
			{
				type: "tool_use",
				id: "call-1",
				name: "read_file",
				input: { path: "README.md" },
			},
		]);
		assert.deepStrictEqual(body.thinking, { type: "disabled" });
	});

	test("prefers max_completion_tokens and rejects invalid thinking budgets", () => {
		const api = new AnthropicApi("claude-budget-model");
		const body = api.prepareRequestBody(
			{ model: "claude-budget-model", messages: [], stream: true },
			model({
				id: "claude-budget-model",
				max_tokens: 8192,
				max_completion_tokens: 2048,
			})
		);
		assert.strictEqual(body.max_tokens, 2048);

		assert.throws(
			() =>
				api.prepareRequestBody(
					{ model: "claude-budget-model", messages: [], stream: true },
					model({
						id: "claude-budget-model",
						max_tokens: 4096,
						thinking: { type: "enabled" },
						thinking_budget: 512,
					})
				),
			/at least 1024 tokens/
		);
		assert.throws(
			() =>
				api.prepareRequestBody(
					{ model: "claude-budget-model", messages: [], stream: true },
					model({
						id: "claude-budget-model",
						max_tokens: 8192,
						max_completion_tokens: 2048,
						thinking: { type: "enabled" },
						thinking_budget: 2048,
					})
				),
			/smaller than max_tokens \(2048\)/
		);
	});

	test("allows interleaved thinking budgets at or above max_tokens", () => {
		const api = new AnthropicApi("claude-interleaved-model");
		const body = api.prepareRequestBody(
			{ model: "claude-interleaved-model", messages: [], stream: true },
			model({
				id: "claude-interleaved-model",
				max_tokens: 2048,
				thinking: { type: "enabled" },
				thinking_budget: 2048,
				headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
			}),
			undefined,
			"https://api.anthropic.com"
		);

		assert.deepStrictEqual(body.thinking, { type: "enabled", budget_tokens: 2048 });
	});

	test("does not apply native Anthropic budget validation to third-party endpoints", () => {
		const api = new AnthropicApi("minimax-anthropic-model");
		const body = api.prepareRequestBody(
			{ model: "minimax-anthropic-model", messages: [], stream: true },
			model({
				id: "minimax-anthropic-model",
				max_tokens: 4096,
				thinking: { type: "enabled" },
				thinking_budget: 512,
			}),
			undefined,
			"https://api.minimax.io/anthropic"
		);

		assert.deepStrictEqual(body.thinking, { type: "enabled", budget_tokens: 512 });
	});

	test("processes a final data line that has no trailing newline", async () => {
		const api = new AnthropicApi("claude-final-line-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = streamFromLines([
			`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "final answer" } })}`,
		]);

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelTextPart && part.value === "final answer"));
	});

	test("rejects an Anthropic provider error received after HTTP 200", async () => {
		const api = new AnthropicApi("claude-error-model");
		const stream = streamFromLines([
			`data: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } })}`,
		]);

		await assert.rejects(
			api.processStreamingResponse(stream, { report() {} }, cancellationToken()),
			/Anthropic streaming error: overloaded_error: overloaded/
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

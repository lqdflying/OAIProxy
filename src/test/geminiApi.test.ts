import * as assert from "assert";
import * as vscode from "vscode";
import { GeminiApi } from "../gemini/geminiApi";
import { COPILOT_USAGE_MIME } from "../responseUsage";

suite("geminiApi", () => {
	function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(lines.join("\n")));
				controller.close();
			},
		});
	}

	test("emits final Gemini usage metadata", async () => {
		const api = new GeminiApi("gemini-usage-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"answer\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":410,\"candidatesTokenCount\":22,\"totalTokenCount\":432,\"cachedContentTokenCount\":300}}",
							"",
						].join("\n")
					)
				);
				controller.close();
			},
		});

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelTextPart && part.value === "answer"));
		const usagePart = parts.find(
			(part): part is vscode.LanguageModelDataPart =>
				part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME
		);
		assert.ok(usagePart);
		assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(usagePart.data)), {
			prompt_tokens: 410,
			completion_tokens: 22,
			total_tokens: 432,
			prompt_tokens_details: { cached_tokens: 300 },
		});
	});

	test("concatenates repeated and prefix text deltas", async () => {
		const api = new GeminiApi("gemini-delta-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = streamFromLines([
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "\n" }] } }] })}`,
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "\n" }] } }] })}`,
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "-prefix" }] } }] })}`,
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "-" }] } }] })}`,
		]);

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.deepStrictEqual(
			parts
				.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
				.map((part) => part.value),
			["\n", "\n", "-prefix", "-"]
		);
	});

	test("concatenates repeated thought deltas before ending the thought block", async () => {
		const api = new GeminiApi("gemini-thought-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = streamFromLines([
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "think", thought: true }] } }] })}`,
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "think", thought: true }] } }] })}`,
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "answer" }] }, finishReason: "STOP" }] })}`,
		]);

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart: new (value: string) => { value: string } })
			.LanguageModelThinkingPart;
		const thinking = parts
			.filter((part): part is { value: string } => part instanceof ThinkingPart)
			.map((part) => part.value)
			.filter(Boolean);
		assert.deepStrictEqual(thinking, ["thinkthink"]);
	});

	test("accepts case-insensitive stop and continuation finish reasons", async () => {
		const api = new GeminiApi("gemini-finish-reason-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = streamFromLines([
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "first" }] }, finishReason: "stop" }] })}`,
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "second" }] }, finish_reason: "continuation" }] })}`,
		]);

		await assert.doesNotReject(
			api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken())
		);

		assert.deepStrictEqual(
			parts
				.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
				.map((part) => part.value),
			["first", "second"]
		);
	});

	test("coalesces image-bearing tool results into an alternating user turn", () => {
		const api = new GeminiApi("gemini-tool-model");
		const messages = [
			{
				role: vscode.LanguageModelChatMessageRole.Assistant,
				name: undefined,
				content: [new vscode.LanguageModelToolCallPart("call-1", "read_image", {})],
			},
			{
				role: vscode.LanguageModelChatMessageRole.User,
				name: undefined,
				content: [
					{
						callId: "call-1",
						content: [new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "image/png")],
					},
				],
			},
		] as unknown as vscode.LanguageModelChatRequestMessage[];

		const converted = api.convertMessages(messages, { includeReasoningInRequest: false });

		assert.deepStrictEqual(converted.map((message) => message.role), ["model", "user"]);
		assert.ok(converted[1].parts.some((part) => "functionResponse" in part));
		assert.ok(converted[1].parts.some((part) => "inlineData" in part));
	});

	test("processes a final data line that has no trailing newline", async () => {
		const api = new GeminiApi("gemini-final-line-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = streamFromLines([
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "final answer" }] }, finishReason: "STOP" }] })}`,
		]);

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelTextPart && part.value === "final answer"));
	});
});

function cancellationToken(): vscode.CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	} as unknown as vscode.CancellationToken;
}

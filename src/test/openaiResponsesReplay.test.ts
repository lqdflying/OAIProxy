import * as assert from "assert";
import * as vscode from "vscode";
import { OpenaiResponsesApi } from "../openai/openaiResponsesApi";
import type { OpenAIResponsesStateIdentity } from "../openai/openaiResponsesState";
import { OPENAI_RESPONSES_REPLAY_METADATA } from "../openai/openaiResponsesReplay";
import { logger } from "../logger";
import {
	createLanguageModelThinkingPart,
	getLanguageModelThinkingMetadata,
	getLanguageModelThinkingText,
	isLanguageModelThinkingPart,
} from "../vscodeCompat";

const identity: OpenAIResponsesStateIdentity = {
	normalizedBaseUrl: "https://chatgpt.com/backend-api/codex",
	modelId: "gpt-6-astra",
	modelInfoId: "gpt-6-astra",
	configId: "oauth",
	accountId: "test-account",
	conversationId: "test-conversation",
};
const opaque = "opaque-test-payload-never-display";
const reasoning = (id = "rs_1", summary: { type: string; text: string }[] = []) => ({
	type: "reasoning",
	id,
	encrypted_content: `${opaque}-${id}`,
	summary,
});
const call = (id = "call_1") => ({
	type: "function_call",
	id: `fc_${id}`,
	call_id: id,
	name: "lookup",
	arguments: "{}",
});
const itemDone = (item: unknown, index: number) => ({ type: "response.output_item.done", output_index: index, item });
const completed = (output?: unknown[]) => ({
	type: "response.completed",
	response: { id: "resp_1", status: "completed", output },
});
const user = {
	role: vscode.LanguageModelChatMessageRole.User,
	name: undefined,
	content: [new vscode.LanguageModelTextPart("look it up")],
};
const options = { codexEasyInput: true, replayResponsesItemIds: false };
const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

async function stream(api: OpenaiResponsesApi, events: unknown[], cancellation = token) {
	const parts: vscode.LanguageModelResponsePart2[] = [];
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const event of events) {
				controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
			}
			controller.close();
		},
	});
	await api.processStreamingResponse(body, { report: (part) => parts.push(part) }, cancellation);
	return parts;
}

function replay(
	parts: vscode.LanguageModelResponsePart2[],
	replayIdentity: OpenAIResponsesStateIdentity | undefined = identity,
	includeReasoning = false
) {
	// Model the host's JSON metadata round trip and its grouping of tool calls at
	// the end of assistant content. Parser/converter business logic is not mocked.
	const thinking = parts.filter(isLanguageModelThinkingPart).map((part) => {
		const wire = JSON.parse(JSON.stringify(part));
		return createLanguageModelThinkingPart(wire.value, wire.id, wire.metadata);
	});
	const content = [
		...parts.filter((part) => part instanceof vscode.LanguageModelTextPart),
		...thinking,
		...parts.filter((part) => part instanceof vscode.LanguageModelToolCallPart),
	];
	const messages = [
		user,
		{ role: vscode.LanguageModelChatMessageRole.Assistant, name: undefined, content },
		{
			role: vscode.LanguageModelChatMessageRole.User,
			name: undefined,
			content: [new vscode.LanguageModelToolResultPart("call_1", [new vscode.LanguageModelTextPart("42")])],
		},
	];
	return new OpenaiResponsesApi("gpt-6-astra", replayIdentity).convertMessages(
		messages as vscode.LanguageModelChatRequestMessage[],
		{ includeReasoningInRequest: includeReasoning },
		options
	);
}

suite("OpenAI OAuth reasoning replay", () => {
	test("supports the host merging thinking deltas into one metadata-bearing part", async () => {
		const parts = await stream(new OpenaiResponsesApi("gpt-6-astra", identity), [
			{ type: "response.reasoning_summary_text.delta", delta: "Visible summary." },
			completed([reasoning("rs_1", [{ type: "summary_text", text: "Visible summary." }]), call()]),
		]);
		const thoughts = parts.filter(isLanguageModelThinkingPart);
		// Copilot's ThinkingDataItem aggregates text and retains the last metadata.
		const metadataPart = [...thoughts].reverse().find((part) => getLanguageModelThinkingMetadata(part));
		assert.ok(metadataPart);
		const merged = createLanguageModelThinkingPart(
			thoughts.map(getLanguageModelThinkingText).join(""),
			"host-id",
			getLanguageModelThinkingMetadata(metadataPart)
		);
		const input = replay(
			[merged, ...parts.filter((part) => part instanceof vscode.LanguageModelToolCallPart)],
			identity,
			true
		);
		assert.deepStrictEqual(
			input.filter((item) => item.type === "reasoning"),
			[reasoning("rs_1", [{ type: "summary_text", text: "Visible summary." }])]
		);
	});

	test("keeps malformed stream content out of error diagnostics", async () => {
		const diagnostics: unknown[][] = [];
		const originalError = console.error;
		const originalLogError = logger.error;
		console.error = (...args) => {
			diagnostics.push(args);
		};
		logger.error = (...args) => {
			diagnostics.push(args);
		};
		try {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`data: {"encrypted_content":"${opaque}" INVALID}\n\n`));
					controller.close();
				},
			});
			await new OpenaiResponsesApi("gpt-6-astra", identity).processStreamingResponse(body, { report() {} }, token);
			assert.ok(diagnostics.length > 0);
			assert.ok(!JSON.stringify(diagnostics).includes(opaque));
		} finally {
			console.error = originalError;
			logger.error = originalLogError;
		}
	});

	test("does not publish opaque state when cancellation occurs after a tool call", async () => {
		const cancellation = { ...token, isCancellationRequested: false };
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const events = [itemDone(reasoning(), 0), itemDone(call(), 1), completed([reasoning(), call()])];
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""))
				);
				controller.close();
			},
		});
		await new OpenaiResponsesApi("gpt-6-astra", identity).processStreamingResponse(
			body,
			{
				report(part) {
					parts.push(part);
					if (part instanceof vscode.LanguageModelToolCallPart) {
						cancellation.isCancellationRequested = true;
					}
				},
			},
			cancellation
		);
		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelToolCallPart));
		assert.ok(!JSON.stringify(parts).includes(opaque));
	});

	test("round trips opaque reasoning without summaries or visible reasoning replay", async () => {
		const item = reasoning();
		const parts = await stream(new OpenaiResponsesApi("gpt-6-astra", identity), [
			itemDone(item, 0),
			itemDone(call(), 1),
			completed([item, call()]),
		]);
		assert.deepStrictEqual(replay(parts).slice(1), [
			item,
			{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
			{ type: "function_call_output", call_id: "call_1", output: "42" },
		]);
		assert.strictEqual(
			parts.filter((part) => !!getLanguageModelThinkingMetadata(part)?.[OPENAI_RESPONSES_REPLAY_METADATA]).length,
			1
		);
		assert.strictEqual(parts.filter(isLanguageModelThinkingPart).map(getLanguageModelThinkingText).join(""), "");
		assert.ok(!JSON.stringify(parts.filter((part) => part instanceof vscode.LanguageModelTextPart)).includes(opaque));
	});

	test("preserves reasoning/tool ordering and deduplicates terminal output and metadata", async () => {
		const first = reasoning("rs_first", [{ type: "summary_text", text: "Check the file." }]);
		const second = reasoning("rs_second");
		const output = [first, call(), second, call("call_2")];
		const parts = await stream(new OpenaiResponsesApi("gpt-6-astra", identity), [
			{ type: "response.reasoning_summary_text.delta", item_id: first.id, delta: "Check the file." },
			...output.map(itemDone),
			completed(output),
		]);
		const metadata = parts.filter(
			(part) => !!getLanguageModelThinkingMetadata(part)?.[OPENAI_RESPONSES_REPLAY_METADATA]
		);
		const restored = replay([...parts, ...metadata], identity, true);
		assert.deepStrictEqual(
			restored.filter((item) => item.type === "reasoning"),
			[first, second]
		);
		assert.deepStrictEqual(
			restored.slice(1, -1).map((item) => (item.type === "function_call" ? item.call_id : item.id)),
			["rs_first", "call_1", "rs_second", "call_2"]
		);
	});

	for (const terminalOnly of [false, true]) {
		test(`supports ${terminalOnly ? "terminal-output-only" : "item-done-only"} reasoning`, async () => {
			const output = [reasoning(), call()];
			const events = terminalOnly ? [completed(output)] : [...output.map(itemDone), completed()];
			const parts = await stream(new OpenaiResponsesApi("gpt-6-astra", identity), events);
			assert.deepStrictEqual(
				replay(parts).filter((item) => item.type === "reasoning"),
				[reasoning()]
			);
			assert.strictEqual(parts.filter((part) => part instanceof vscode.LanguageModelToolCallPart).length, 1);
		});
	}

	test("isolates replay across model, endpoint, configuration, account and conversation", async () => {
		const parts = await stream(new OpenaiResponsesApi("gpt-6-astra", identity), [completed([reasoning(), call()])]);
		for (const key of [
			"modelId",
			"modelInfoId",
			"normalizedBaseUrl",
			"configId",
			"accountId",
			"conversationId",
		] as const) {
			assert.strictEqual(
				replay(parts, { ...identity, [key]: "different" }).filter((item) => item.type === "reasoning").length,
				0,
				key
			);
		}
		const generic = new OpenaiResponsesApi("gpt-6-astra");
		const messages = [{ role: vscode.LanguageModelChatMessageRole.Assistant, name: undefined, content: parts }];
		assert.ok(
			!JSON.stringify(
				generic.convertMessages(messages as vscode.LanguageModelChatRequestMessage[], {
					includeReasoningInRequest: true,
				})
			).includes(opaque)
		);
		assert.ok(!JSON.stringify(await stream(generic, [completed([reasoning()])])).includes(opaque));
	});

	test("falls back to the first input when the host supplies no conversation id", async () => {
		const fallbackIdentity = { ...identity, conversationId: undefined };
		const api = new OpenaiResponsesApi("gpt-6-astra", fallbackIdentity);
		api.convertMessages([user], { includeReasoningInRequest: false }, options);
		const parts = await stream(api, [completed([reasoning(), call()])]);
		assert.deepStrictEqual(
			replay(parts, fallbackIdentity).filter((item) => item.type === "reasoning"),
			[reasoning()]
		);
	});

	test("rejects malformed metadata and preserves the user's current tool arguments", async () => {
		const parts = await stream(new OpenaiResponsesApi("gpt-6-astra", identity), [completed([reasoning(), call()])]);
		const tool = parts.find(
			(part) => part instanceof vscode.LanguageModelToolCallPart
		) as vscode.LanguageModelToolCallPart;
		tool.input = { edited: true };
		assert.strictEqual(
			(replay(parts).find((item) => item.type === "function_call") as { arguments: string }).arguments,
			'{"edited":true}'
		);
		const invalid = createLanguageModelThinkingPart("", "invalid", {
			[OPENAI_RESPONSES_REPLAY_METADATA]: {
				version: 1,
				scope: new OpenaiResponsesApi("gpt-6-astra", identity).conversationKey,
				output: [{ ...reasoning(), summary: [{ type: "bad", text: "bad" }] }],
			},
		});
		assert.strictEqual(replay([invalid]).filter((item) => item.type === "reasoning").length, 0);
	});

	test("withholds opaque state on failed, cancelled, truncated and locally cancelled streams", async () => {
		for (const ending of [
			undefined,
			{ type: "response.failed", response: { error: { message: "failed" } } },
			{ type: "response.cancelled" },
		]) {
			const api = new OpenaiResponsesApi("gpt-6-astra", identity);
			const parts: vscode.LanguageModelResponsePart2[] = [];
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const event of [itemDone(reasoning(), 0), ending].filter(Boolean)) {
						controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
					}
					controller.close();
				},
			});
			const run = api.processStreamingResponse(body, { report: (part) => parts.push(part) }, token);
			if (ending) {
				await assert.rejects(run);
			} else {
				await run;
			}
			assert.ok(!JSON.stringify(parts).includes(opaque));
		}
		const cancelled = { ...token, isCancellationRequested: true };
		assert.ok(
			!JSON.stringify(
				await stream(new OpenaiResponsesApi("gpt-6-astra", identity), [completed([reasoning()])], cancelled)
			).includes(opaque)
		);
	});
});

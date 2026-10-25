import * as assert from "assert";

import type { ResponsesInputItem } from "../openai/openaiResponsesApi";
import { createOpenAIResponsesConversationKey, OpenAIResponsesStateStore } from "../openai/openaiResponsesState";

suite("openaiResponsesState", () => {
	test("keeps affinity stable across request changes while refusing incompatible previous-response reuse", () => {
		const store = new OpenAIResponsesStateStore();
		const originalIdentity = { ...identity(), conversationId: "chat-1", accountId: "account-1" };
		const fullInput = [user("first")];
		const first = store.resolve({ identity: originalIdentity, fullInput });
		store.update({ stateKey: first.stateKey, responseId: "resp_1", inputSignatures: first.inputSignatures });
		const affinity = createOpenAIResponsesConversationKey(originalIdentity, fullInput);
		assert.ok(affinity);
		assert.ok(!affinity.includes("chat-1"));
		for (const change of [{ instructions: "new instructions" }, { tools: [] }, { toolChoice: "required" }]) {
			const changedIdentity = { ...originalIdentity, ...change };
			assert.strictEqual(createOpenAIResponsesConversationKey(changedIdentity, fullInput), affinity);
			const second = store.resolve({ identity: changedIdentity, fullInput: [...fullInput, assistant("answer"), user("second")] });
			assert.notStrictEqual(second.stateKey, first.stateKey);
			assert.strictEqual(second.responseId, undefined);
		}
		// Compaction replaces the first input but must not rotate an explicit conversation's affinity.
		assert.strictEqual(createOpenAIResponsesConversationKey(originalIdentity, [user("summary")]), affinity);
	});

	test("isolates affinity and previous-response memory by conversation, account, model and configuration", () => {
		const originalIdentity = { ...identity(), conversationId: "chat-1", accountId: "account-1" };
		const fullInput = [user("same first prompt")];
		const store = new OpenAIResponsesStateStore();
		const first = store.resolve({ identity: originalIdentity, fullInput });
		store.update({ stateKey: first.stateKey, responseId: "resp_1", inputSignatures: first.inputSignatures });
		for (const key of ["conversationId", "accountId", "normalizedBaseUrl", "modelId", "modelInfoId", "configId", "requestInitiator"] as const) {
			const changedIdentity = { ...originalIdentity, [key]: "different" };
			assert.notStrictEqual(createOpenAIResponsesConversationKey(changedIdentity, fullInput), createOpenAIResponsesConversationKey(originalIdentity, fullInput), key);
			assert.strictEqual(store.resolve({ identity: changedIdentity, fullInput: [...fullInput, user("next")] }).memoryStateFound, false, key);
		}
	});

	test("uses a stable first-input fallback when conversation identity is unavailable", () => {
		const key = createOpenAIResponsesConversationKey(identity(), [user("first")]);
		assert.ok(key);
		assert.strictEqual(createOpenAIResponsesConversationKey({ ...identity(), toolChoice: "required" }, [user("first"), user("next")]), key);
		assert.notStrictEqual(createOpenAIResponsesConversationKey(identity(), [user("different")]), key);
		assert.strictEqual(createOpenAIResponsesConversationKey(identity(), []), undefined);
	});

	test("uses memory state for appended user input and skips the previous assistant response", () => {
		const store = new OpenAIResponsesStateStore({ ttlMs: 1000, maxEntries: 10 });
		const first = store.resolve({
			identity: identity(),
			fullInput: [user("first", "incomplete")],
			now: 0,
		});

		assert.strictEqual(store.update({
			stateKey: first.stateKey,
			responseId: "resp_1",
			inputSignatures: first.inputSignatures,
			now: 0,
		}), true);

		const second = store.resolve({
			identity: identity(),
			fullInput: [user("first"), assistant("answer"), user("second", "incomplete")],
			now: 100,
		});

		assert.strictEqual(second.memoryStateFound, true);
		assert.strictEqual(second.memoryPrefixMatched, true);
		assert.strictEqual(second.responseId, "resp_1");
		assert.strictEqual(second.memorySkippedAssistantInputCount, 1);
		assert.strictEqual(second.memoryDeltaInputCount, 1);
		assert.deepStrictEqual(second.deltaInput, [user("second", "incomplete")]);
	});

	test("keeps tool output in delta while skipping the previous assistant tool call", () => {
		const store = new OpenAIResponsesStateStore({ ttlMs: 1000, maxEntries: 10 });
		const first = store.resolve({
			identity: identity(),
			fullInput: [user("call tool")],
			now: 0,
		});
		store.update({
			stateKey: first.stateKey,
			responseId: "resp_tool",
			inputSignatures: first.inputSignatures,
			now: 0,
		});

		const second = store.resolve({
			identity: identity(),
			fullInput: [user("call tool"), toolCall("call_1"), toolOutput("call_1", "42")],
			now: 100,
		});

		assert.strictEqual(second.memoryPrefixMatched, true);
		assert.strictEqual(second.memorySkippedAssistantInputCount, 1);
		assert.deepStrictEqual(second.deltaInput, [toolOutput("call_1", "42")]);
	});

	test("does not reuse state when the conversation anchor changes", () => {
		const store = new OpenAIResponsesStateStore({ ttlMs: 1000, maxEntries: 10 });
		const first = store.resolve({
			identity: identity(),
			fullInput: [user("first")],
			now: 0,
		});
		store.update({
			stateKey: first.stateKey,
			responseId: "resp_1",
			inputSignatures: first.inputSignatures,
			now: 0,
		});

		const changed = store.resolve({
			identity: identity(),
			fullInput: [user("changed"), assistant("answer"), user("second")],
			now: 100,
		});

		assert.strictEqual(changed.memoryStateFound, false);
		assert.strictEqual(changed.responseId, undefined);
		assert.strictEqual(changed.deltaInput, null);
	});

	test("expires stale state before reuse", () => {
		const store = new OpenAIResponsesStateStore({ ttlMs: 1000, maxEntries: 10 });
		const first = store.resolve({
			identity: identity(),
			fullInput: [user("first")],
			now: 0,
		});
		store.update({
			stateKey: first.stateKey,
			responseId: "resp_1",
			inputSignatures: first.inputSignatures,
			now: 0,
		});

		const expired = store.resolve({
			identity: identity(),
			fullInput: [user("first"), assistant("answer"), user("second")],
			now: 1001,
		});

		assert.strictEqual(expired.memoryStateFound, true);
		assert.strictEqual(expired.memoryStateExpired, true);
		assert.strictEqual(expired.memoryPrefixMatched, false);
		assert.strictEqual(expired.deltaInput, null);
		assert.strictEqual(store.size, 0);
	});

	test("disables reuse for unsupported base URLs and after clear", () => {
		const store = new OpenAIResponsesStateStore({ ttlMs: 1000, maxEntries: 10 });
		const first = store.resolve({
			identity: identity(),
			fullInput: [user("first")],
			now: 0,
		});
		store.update({
			stateKey: first.stateKey,
			responseId: "resp_1",
			inputSignatures: first.inputSignatures,
			now: 0,
		});

		const unsupported = store.resolve({
			identity: identity(),
			fullInput: [user("first"), assistant("answer"), user("second")],
			now: 100,
			previousResponseIdUnsupported: true,
		});

		assert.strictEqual(unsupported.memoryStateFound, true);
		assert.strictEqual(unsupported.memoryPrefixMatched, false);
		assert.strictEqual(unsupported.deltaInput, null);

		store.clear(first.stateKey);
		const cleared = store.resolve({
			identity: identity(),
			fullInput: [user("first"), assistant("answer"), user("second")],
			now: 100,
		});

		assert.strictEqual(cleared.memoryStateFound, false);
	});
});

function identity() {
	return {
		normalizedBaseUrl: "https://api.openai.com/v1",
		modelId: "gpt-5.5",
		modelInfoId: "gpt-5.5",
		configId: undefined,
		requestInitiator: "test",
		instructions: "be useful",
		tools: [{ type: "function", name: "lookup" }],
		toolChoice: "auto",
	};
}

function user(text: string, status: "completed" | "incomplete" = "completed"): ResponsesInputItem {
	return {
		role: "user",
		content: [{ type: "input_text", text }],
		type: "message",
		status,
	};
}

function assistant(text: string): ResponsesInputItem {
	return {
		role: "assistant",
		content: [{ type: "output_text", text }],
		type: "message",
		id: "msg_random",
		status: "completed",
	};
}

function toolCall(callId: string): ResponsesInputItem {
	return {
		type: "function_call",
		id: `fc_${callId}`,
		call_id: callId,
		name: "lookup",
		arguments: "{}",
		status: "completed",
	};
}

function toolOutput(callId: string, output: string): ResponsesInputItem {
	return {
		type: "function_call_output",
		call_id: callId,
		output,
		id: `fco_${callId}`,
		status: "completed",
	};
}

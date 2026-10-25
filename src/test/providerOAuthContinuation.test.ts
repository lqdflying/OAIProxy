import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { HuggingFaceChatModelProvider } from "../provider";
import { OPENAI_CODEX_RESPONSES_BASE_URL, OPENAI_OAUTH_SECRET_KEY } from "../openaiOAuth";
import { TokenizerManager } from "../tokenizer/tokenizerManager";
import { logger } from "../logger";

suite("OAuth provider continuation", () => {
	const originalFetch = globalThis.fetch;
	const originalConfig = vscode.workspace.getConfiguration;
	const originalDebug = logger.debug;
	let provider: HuggingFaceChatModelProvider;
	let credential: { accessToken: string; refreshToken: string; expiresAt: number; accountId?: string };
	let requests: { body: Record<string, unknown>; headers: Headers }[];
	let logs: { tag: string; data: Record<string, unknown> }[];
	let rejectPreviousResponse: boolean;
	const reasoning = { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "opaque-integration-fixture" };
	const call = { type: "function_call", id: "fc_test", call_id: "call_test", name: "lookup", arguments: "{}" };
	const user = {
		role: vscode.LanguageModelChatMessageRole.User,
		name: undefined,
		content: [new vscode.LanguageModelTextPart("look up the answer")],
	};
	const model = {
		id: "gpt-6-astra",
		name: "Astra",
		maxInputTokens: 922000,
		maxOutputTokens: 128000,
		capabilities: { imageInput: false, toolCalling: true },
	} as vscode.LanguageModelChatInformation;

	setup(() => {
		TokenizerManager.setExtensionPath(path.resolve(__dirname, "../.."));
		requests = [];
		logs = [];
		rejectPreviousResponse = false;
		credential = {
			accessToken: "fake-test-token",
			refreshToken: "fake-refresh",
			expiresAt: Date.now() + 3600000,
			accountId: "account-a",
		};
		const config: Record<string, unknown> = {
			"oaicopilot.models": [
				{
					id: "gpt-6-astra",
					owned_by: "openai-oauth",
					authMode: "oauth",
					baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
					apiMode: "openai-responses",
					reasoning_effort: "xhigh",
					extra: { service_tier: "fast" },
				},
			],
			"oaicopilot.retry": { enabled: false },
		};
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => config[key] ?? fallback,
		})) as typeof originalConfig;
		logger.debug = (tag, data) => {
			// Production logger summarizes stream chunks separately; inspect only
			// the safe provider request/timing diagnostics here.
			if (tag === "request.body" || tag === "request.timing" || tag === "responses.codex.affinity") {
				logs.push({ tag, data });
			}
		};
		globalThis.fetch = async (url, init) => {
			assert.strictEqual(url, `${OPENAI_CODEX_RESPONSES_BASE_URL}/responses`);
			const body = JSON.parse(String(init?.body));
			requests.push({ body, headers: new Headers(init?.headers) });
			if (rejectPreviousResponse && body.previous_response_id) {
				return new Response('{"error":{"message":"Unsupported parameter: previous_response_id"}}', { status: 400 });
			}
			const events = [
				{ type: "response.output_item.done", output_index: 0, item: reasoning },
				{ type: "response.output_item.done", output_index: 1, item: call },
				{
					type: "response.completed",
					response: { id: `resp_${requests.length}`, status: "completed", output: [reasoning, call] },
				},
			];
			return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
				headers: { "Content-Type": "text/event-stream" },
			});
		};
		provider = new HuggingFaceChatModelProvider(
			{
				get: async (key: string) => (key === OPENAI_OAUTH_SECRET_KEY ? JSON.stringify(credential) : undefined),
			} as unknown as vscode.SecretStorage,
			{ get: () => undefined, update: async () => undefined } as unknown as vscode.Memento,
			{ show() {} } as vscode.StatusBarItem
		);
	});
	teardown(() => {
		provider.dispose();
		globalThis.fetch = originalFetch;
		vscode.workspace.getConfiguration = originalConfig;
		logger.debug = originalDebug;
	});
	async function run(messages: vscode.LanguageModelChatRequestMessage[], conversationId = "chat-a", required = false) {
		const cancellation = new vscode.CancellationTokenSource();
		const parts: vscode.LanguageModelResponsePart2[] = [];
		try {
			await provider.provideLanguageModelChatResponse(
				model,
				messages,
				{
					requestInitiator: "test",
					modelOptions: { _conversationId: conversationId },
					tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
					toolMode: required ? vscode.LanguageModelChatToolMode.Required : vscode.LanguageModelChatToolMode.Auto,
				} as vscode.ProvideLanguageModelChatResponseOptions,
				{ report: (part) => parts.push(part) },
				cancellation.token
			);
			return parts;
		} finally {
			cancellation.dispose();
		}
	}
	function continuation(parts: vscode.LanguageModelResponsePart2[]) {
		// The host may drop our data marker. Memory-state fallback must still work.
		return [
			user,
			{
				role: vscode.LanguageModelChatMessageRole.Assistant,
				name: undefined,
				content: parts.filter((part) => !(part instanceof vscode.LanguageModelDataPart)),
			},
			{
				role: vscode.LanguageModelChatMessageRole.User,
				name: undefined,
				content: [new vscode.LanguageModelToolResultPart("call_test", [new vscode.LanguageModelTextPart("42")])],
			},
		] as vscode.LanguageModelChatRequestMessage[];
	}

	test("replays opaque state after a real previous-response fallback and retains Fast/xhigh/body restrictions", async () => {
		const parts = await run([user]);
		rejectPreviousResponse = true;
		await run(continuation(parts));
		assert.strictEqual(requests.length, 3);
		assert.strictEqual(requests[1].body.previous_response_id, "resp_1");
		assert.deepStrictEqual(requests[1].body.input, [
			{ type: "function_call_output", call_id: "call_test", output: "42" },
		]);
		assert.strictEqual(requests[2].body.previous_response_id, undefined);
		assert.deepStrictEqual((requests[2].body.input as unknown[])[1], reasoning);
		for (const request of requests) {
			assert.strictEqual(request.body.store, false);
			assert.strictEqual(request.body.service_tier, "priority");
			assert.deepStrictEqual(request.body.reasoning, { effort: "xhigh" });
			assert.strictEqual(request.body.prompt_cache_key, undefined);
			assert.strictEqual(request.body.max_output_tokens, undefined);
			assert.strictEqual(request.headers.get("session_id"), requests[0].headers.get("session_id"));
			assert.strictEqual(request.headers.get("x-client-request-id"), request.headers.get("session_id"));
		}
		assert.ok(requests[0].headers.get("session_id"));
		assert.ok(
			logs.some(
				({ tag, data }) =>
					tag === "request.body" && (data.requestBody as Record<string, unknown>).encryptedReasoningItemCount === 1
			)
		);
		assert.ok(!JSON.stringify(logs).includes(reasoning.encrypted_content));
		assert.ok(
			!logs.some(({ tag, data }) => tag === "request.timing" && data.phase === "firstThinking"),
			"hidden metadata is not visible thinking"
		);
	});

	test("keeps session headers stable when tool choice changes, and isolates other conversations", async () => {
		await run([user]);
		await run([user], "chat-a", true);
		await run([user], "chat-b", true);
		assert.notDeepStrictEqual(requests[0].body.tool_choice, requests[1].body.tool_choice);
		assert.strictEqual(requests[1].headers.get("session_id"), requests[0].headers.get("session_id"));
		assert.notStrictEqual(requests[2].headers.get("session_id"), requests[0].headers.get("session_id"));
	});

	for (const missingAccount of [false, true]) {
		test(`isolates credentials ${missingAccount ? "without" : "with"} an account id`, async () => {
			if (missingAccount) {
				delete credential.accountId;
			}
			const parts = await run([user]);
			if (missingAccount) {
				credential.accessToken = "other-fake-test-token";
			} else {
				credential.accountId = "account-b";
			}
			await run(continuation(parts));
			assert.strictEqual(requests[1].body.previous_response_id, undefined);
			assert.ok(!JSON.stringify(requests[1].body).includes(reasoning.encrypted_content));
			assert.notStrictEqual(requests[1].headers.get("session_id"), requests[0].headers.get("session_id"));
		});
	}
});

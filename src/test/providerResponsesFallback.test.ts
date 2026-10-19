import * as assert from "assert";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import { HuggingFaceChatModelProvider } from "../provider";
import { TokenizerManager } from "../tokenizer/tokenizerManager";
import { logger } from "../logger";

suite("Responses previous_response_id fallback", () => {
	let server: http.Server;
	let baseUrl: string;
	let received: Record<string, unknown>[];
	let failures: Array<{ status: number; body: string }>;
	let configuration: Record<string, unknown>;
	let provider: HuggingFaceChatModelProvider;
	const originalConfig = vscode.workspace.getConfiguration;
	const originalDebug = logger.debug;

	setup(async () => {
		TokenizerManager.setExtensionPath(path.resolve(__dirname, "../.."));
		received = [];
		failures = [];
		server = http.createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk.toString();
			});
			request.on("end", () => {
				const parsedBody = JSON.parse(body) as Record<string, unknown>;
				received.push(parsedBody);
				const failure = parsedBody.previous_response_id !== undefined ? failures.shift() : undefined;
				if (failure) {
					response.writeHead(failure.status, { "Content-Type": "application/json" });
					response.end(failure.body);
					return;
				}
				response.writeHead(200, { "Content-Type": "text/event-stream" });
				response.end(
					`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "OK" })}\n\n` +
						`data: ${JSON.stringify({ type: "response.completed", response: { id: `resp_${received.length}`, usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } } } })}\n\n`
				);
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
		configuration = {
			"oaicopilot.models": [
				{
					id: "gpt-6-astra",
					owned_by: "test",
					baseUrl,
					apiMode: "openai-responses",
				},
			],
			"oaicopilot.retry": { enabled: false },
		};
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => configuration[key] ?? fallback,
		})) as typeof originalConfig;
		logger.debug = () => undefined;
		provider = new HuggingFaceChatModelProvider(
			{ get: async () => "local-test-only" } as unknown as vscode.SecretStorage,
			{
				get: () => undefined,
				update: async () => undefined,
			} as unknown as vscode.Memento,
			{ show: () => undefined } as vscode.StatusBarItem
		);
	});

	teardown(async () => {
		provider?.dispose();
		vscode.workspace.getConfiguration = originalConfig;
		logger.debug = originalDebug;
		server.closeAllConnections();
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	});

	const model = () =>
		({
			id: "gpt-6-astra",
			name: "Astra",
			maxInputTokens: 872000,
			maxOutputTokens: 128000,
			capabilities: { imageInput: false, toolCalling: true },
		}) as vscode.LanguageModelChatInformation;
	const msg = (role: number, text: string) =>
		({ role, name: undefined, content: [new vscode.LanguageModelTextPart(text)] }) as vscode.LanguageModelChatRequestMessage;
	const run = async (messages: vscode.LanguageModelChatRequestMessage[]) => {
		const cancellation = new vscode.CancellationTokenSource();
		try {
			await provider.provideLanguageModelChatResponse(
				model(),
				messages,
				{ requestInitiator: "test" } as vscode.ProvideLanguageModelChatResponseOptions,
				{ report: () => undefined },
				cancellation.token
			);
		} finally {
			cancellation.dispose();
		}
	};

	test("keeps state enabled after a previous response is not found", async () => {
		failures.push({
			status: 404,
			body: JSON.stringify({
				error: {
					message: "Previous response not found",
					type: "invalid_request_error",
					param: "previous_response_id",
					code: "previous_response_not_found",
				},
			}),
		});
		const first = msg(1, "first");
		await run([first]);
		await run([first, msg(2, "OK"), msg(1, "second")]);

		assert.strictEqual(received.length, 3);
		assert.strictEqual(received[1].previous_response_id, "resp_1");
		assert.strictEqual(received[2].previous_response_id, undefined);
		assert.ok((received[2].input as unknown[]).length > (received[1].input as unknown[]).length);

		await run([first, msg(2, "OK"), msg(1, "second"), msg(2, "OK"), msg(1, "third")]);
		assert.strictEqual(received.length, 4);
		assert.strictEqual(received[3].previous_response_id, "resp_3");
	});

	test("does not disable state for an unrelated authorization failure", async () => {
		failures.push({
			status: 401,
			body: JSON.stringify({
				error: {
					message: "Invalid authentication credentials",
					type: "invalid_request_error",
				},
			}),
		});
		const first = msg(1, "first");
		await run([first]);
		await assert.rejects(run([first, msg(2, "OK"), msg(1, "second")]), /\[401\]/u);

		await run([first, msg(2, "OK"), msg(1, "second")]);
		assert.strictEqual(received.length, 3);
		assert.strictEqual(received[2].previous_response_id, "resp_1");
	});

	test("marks the scope unsupported for an unsupported previous_response_id parameter", async () => {
		failures.push({
			status: 400,
			body: JSON.stringify({
				error: {
					message: "Unsupported parameter: previous_response_id",
					type: "invalid_request_error",
					param: "previous_response_id",
				},
			}),
		});
		const first = msg(1, "first");
		await run([first]);
		await run([first, msg(2, "OK"), msg(1, "second")]);

		assert.strictEqual(received.length, 3);
		assert.strictEqual(received[1].previous_response_id, "resp_1");
		assert.strictEqual(received[2].previous_response_id, undefined);

		await run([first, msg(2, "OK"), msg(1, "second"), msg(2, "OK"), msg(1, "third")]);
		assert.strictEqual(received.length, 4);
		assert.strictEqual(received[3].previous_response_id, undefined);
	});
});

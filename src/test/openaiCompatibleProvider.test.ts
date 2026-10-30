import * as assert from "assert";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";

import { logger } from "../logger";
import { HuggingFaceChatModelProvider } from "../provider";
import { TokenizerManager } from "../tokenizer/tokenizerManager";

interface CapturedRequest {
	url: string;
	headers: http.IncomingHttpHeaders;
	body: Record<string, unknown>;
}

suite("OpenAI Compatible provider routing", () => {
	let server: http.Server;
	let baseUrl: string;
	let captured: CapturedRequest[];
	let configuration: Record<string, unknown>;
	let provider: HuggingFaceChatModelProvider;
	const originalConfig = vscode.workspace.getConfiguration;
	const originalDebug = logger.debug;

	setup(async () => {
		TokenizerManager.setExtensionPath(path.resolve(__dirname, "../.."));
		captured = [];
		server = http.createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk.toString();
			});
			request.on("end", () => {
				captured.push({
					url: request.url ?? "",
					headers: request.headers,
					body: JSON.parse(body) as Record<string, unknown>,
				});
				response.writeHead(200, { "Content-Type": "text/event-stream" });
				response.end(
					`data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "OK" } }] })}\n\n` +
						`data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } })}\n\n` +
						"data: [DONE]\n\n"
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
					configId: "openai-compatible",
					owned_by: "openai-compatible",
					baseUrl,
					apiMode: "openai-compatible",
					context_length: 258000,
					max_tokens: 128000,
					temperature: 0.3,
					top_p: 0.9,
					reasoning_effort: "xhigh",
					prompt_cache: { enabled: true },
				},
				{
					id: "gpt-5.6-sol",
					configId: "openai-compatible",
					owned_by: "openai-compatible",
					baseUrl,
					apiMode: "openai-compatible",
					context_length: 258000,
					max_tokens: 128000,
					temperature: 0.3,
					reasoning_effort: "max",
					prompt_cache: { enabled: true },
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

	const chatModel = (id: string) =>
		({
			id,
			name: id,
			maxInputTokens: 258000,
			maxOutputTokens: 128000,
			capabilities: { imageInput: false, toolCalling: true },
		}) as vscode.LanguageModelChatInformation;
	const userMessage = (text: string) =>
		({
			role: 1,
			name: undefined,
			content: [new vscode.LanguageModelTextPart(text)],
		}) as vscode.LanguageModelChatRequestMessage;

	const run = async (modelId: string, options: Record<string, unknown> = {}) => {
		const cancellation = new vscode.CancellationTokenSource();
		const parts: vscode.LanguageModelResponsePart2[] = [];
		try {
			await provider.provideLanguageModelChatResponse(
				chatModel(modelId),
				[userMessage("Say OK")],
				{ requestInitiator: "test", ...options } as vscode.ProvideLanguageModelChatResponseOptions,
				{ report: (part) => parts.push(part) },
				cancellation.token
			);
		} finally {
			cancellation.dispose();
		}
		return parts;
	};

	test("routes to /chat/completions with the compatible request shape", async () => {
		const parts = await run("gpt-6-astra");

		assert.strictEqual(captured.length, 1);
		const [{ url, headers, body }] = captured;
		assert.strictEqual(url, "/v1/chat/completions");
		assert.strictEqual(headers.authorization, "Bearer local-test-only");
		assert.strictEqual(body.model, "gpt-6-astra");
		assert.strictEqual(body.stream, true);
		assert.deepStrictEqual(body.stream_options, { include_usage: true });
		assert.strictEqual(body.max_tokens, 128000);
		assert.strictEqual(body.max_completion_tokens, undefined);
		assert.strictEqual(body.reasoning_effort, "xhigh");
		assert.strictEqual(body.temperature, undefined, "Astra sampling controls must be pruned");
		assert.strictEqual(body.top_p, undefined);
		assert.strictEqual(body.reasoning, undefined);
		assert.strictEqual(body.thinking, undefined);
		assert.strictEqual(typeof body.prompt_cache_key, "string");
		assert.ok((body.prompt_cache_key as string).startsWith("oaiproxy-cc-"));

		const text = parts
			.filter((part) => part instanceof vscode.LanguageModelTextPart)
			.map((part) => (part as vscode.LanguageModelTextPart).value)
			.join("");
		assert.strictEqual(text, "OK");
	});

	test("keeps sampling controls for models that accept them", async () => {
		await run("gpt-5.6-sol");

		assert.strictEqual(captured.length, 1);
		const [{ body }] = captured;
		assert.strictEqual(body.model, "gpt-5.6-sol");
		assert.strictEqual(body.temperature, 0.3);
		assert.strictEqual(body.reasoning_effort, "max");
		assert.strictEqual(body.max_tokens, 128000);
	});

	test("applies a picker effort to a row that stores nested reasoning", async () => {
		configuration["oaicopilot.models"] = [
			{
				id: "nested-reasoning-model",
				configId: "openai-compatible",
				owned_by: "openai-compatible",
				baseUrl,
				apiMode: "openai-compatible",
				context_length: 32000,
				max_tokens: 1024,
				reasoning: { effort: "high" },
			},
		];

		await run("nested-reasoning-model", { modelOptions: { reasoningEffort: "low" } });

		assert.strictEqual(captured.length, 1);
		const [{ body }] = captured;
		assert.strictEqual(body.reasoning_effort, "low");
		assert.strictEqual(body.reasoning, undefined);
	});

	test("does not add generic prompt-cache fields for compatible rows", async () => {
		const originalFetch = globalThis.fetch;
		const bodies: Record<string, unknown>[] = [];
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			return new Response(
				`data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "OK" } }] })}\n\n` +
					`data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })}\n\n` +
					"data: [DONE]\n\n",
				{ status: 200, headers: { "Content-Type": "text/event-stream" } }
			);
		}) as typeof fetch;

		try {
			for (const compatibleBaseUrl of [
				"https://api.openai.com/v1",
				"https://api.fireworks.ai/inference/v1",
			]) {
				configuration["oaicopilot.models"] = [
					{
						id: "gpt-6-astra",
						configId: "openai-compatible",
						owned_by: "openai-compatible",
						baseUrl: compatibleBaseUrl,
						apiMode: "openai-compatible",
						context_length: 258000,
						max_tokens: 128000,
						reasoning_effort: "xhigh",
					},
				];
				await run("gpt-6-astra");
			}
		} finally {
			globalThis.fetch = originalFetch;
		}

		assert.strictEqual(bodies.length, 2);
		for (const body of bodies) {
			assert.strictEqual(body.prompt_cache_key, undefined);
			assert.strictEqual(body.prompt_cache_retention, undefined);
			assert.strictEqual(body.user, undefined);
		}
	});
});

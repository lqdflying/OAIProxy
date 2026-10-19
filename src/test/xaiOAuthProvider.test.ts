import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { HuggingFaceChatModelProvider } from "../provider";
import { TokenizerManager, tokenizerManager } from "../tokenizer/tokenizerManager";
import { XAI_GROK_OAUTH_BASE_URL, XAI_OAUTH_SECRET_KEY } from "../xaiOAuth";

suite("xaiOAuth provider integration", () => {
	const originalConfig = vscode.workspace.getConfiguration;
	const originalFetch = globalThis.fetch;
	let provider: HuggingFaceChatModelProvider;
	let configuration: Record<string, unknown>;
	let capturedUrl: string;
	let capturedHeaders: Record<string, string>;
	let capturedBody: Record<string, unknown>;

	suiteSetup(async () => {
		TokenizerManager.setExtensionPath(path.resolve(__dirname, "../.."));
		await tokenizerManager.getTokenizer();
	});

	setup(() => {
		capturedUrl = "";
		capturedHeaders = {};
		capturedBody = {};
		configuration = {
			"oaicopilot.models": [
				{
					id: "grok-4.7",
					configId: "xai-oauth",
					owned_by: "xai",
					authMode: "oauth",
					baseUrl: XAI_GROK_OAUTH_BASE_URL,
					apiMode: "openai-responses",
					context_length: 500000,
					max_tokens: 64000,
					reasoning_effort: "high",
					supports_reasoning_effort: true,
					supported_reasoning_efforts: ["low", "medium", "high", "xhigh"],
					default_reasoning_effort: "high",
					toolCalling: true,
					include_reasoning_in_request: true,
				},
			],
			"oaicopilot.retry": { enabled: false },
		};
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => configuration[key] ?? fallback,
			update: async () => undefined,
			inspect: () => undefined,
		})) as unknown as typeof originalConfig;

		globalThis.fetch = (async (input, init) => {
			capturedUrl = String(input);
			capturedHeaders = init?.headers as Record<string, string>;
			capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								[
									"data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK\"}",
									"",
									"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_xai\"}}",
									"",
								].join("\n")
							)
						);
						controller.close();
					},
				}),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } }
			);
		}) as typeof fetch;

		provider = new HuggingFaceChatModelProvider(
			{
				get: async (key: string) =>
					key === XAI_OAUTH_SECRET_KEY
						? JSON.stringify({
								accessToken: "xai-access-token",
								refreshToken: "xai-refresh-token",
								tokenEndpoint: "https://auth.x.ai/oauth2/token",
								expiresAt: Date.now() + 60 * 60 * 1000,
							})
						: undefined,
				store: async () => undefined,
				delete: async () => undefined,
			} as unknown as vscode.SecretStorage,
			{
				get: (_key: string, fallback: unknown) => fallback,
				update: async () => undefined,
			} as unknown as vscode.Memento,
			{
				show: () => undefined,
				hide: () => undefined,
				dispose: () => undefined,
			} as unknown as vscode.StatusBarItem
		);
	});

	teardown(() => {
		provider.dispose();
		vscode.workspace.getConfiguration = originalConfig;
		globalThis.fetch = originalFetch;
	});

	test("uses the base model ID for the xAI OAuth override header and request body", async () => {
		const cancellation = new vscode.CancellationTokenSource();
		try {
			await provider.provideLanguageModelChatResponse(
				{
					id: "grok-4.7::xai-oauth",
					name: "Grok 4.7 (OAuth)",
					maxInputTokens: 500000,
					maxOutputTokens: 64000,
					capabilities: { toolCalling: true },
				} as vscode.LanguageModelChatInformation,
				[vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart("hello")])],
				{ requestInitiator: "test", toolMode: vscode.LanguageModelChatToolMode.Auto },
				{ report() {} },
				cancellation.token
			);
		} finally {
			cancellation.dispose();
		}

		assert.strictEqual(capturedUrl, `${XAI_GROK_OAUTH_BASE_URL}/responses`);
		assert.strictEqual(capturedBody.model, "grok-4.7");
		assert.strictEqual(capturedHeaders["x-grok-model-override"], "grok-4.7");
		assert.strictEqual(capturedHeaders["x-grok-model-override"], capturedBody.model);
	});
});

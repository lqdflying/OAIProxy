import * as assert from "assert";
import * as vscode from "vscode";
import { fetchOllamaModels, OllamaApi } from "../ollama/ollamaApi";
import { COPILOT_USAGE_MIME } from "../responseUsage";
import type { HFModelItem } from "../types";

suite("ollamaApi", () => {
	test("maps thinking and max_completion_tokens into the native request body", () => {
		const api = new OllamaApi("ollama-test-model");

		const disabled = api.prepareRequestBody(
			{ model: "ollama-test-model", messages: [], stream: true },
			model({ enable_thinking: false, max_completion_tokens: 2048, max_tokens: 512 })
		);
		assert.strictEqual(disabled.think, false);
		assert.strictEqual(disabled.options?.num_predict, 2048);

		const enabled = api.prepareRequestBody(
			{ model: "ollama-test-model", messages: [], stream: true },
			model({ thinking: { type: "enabled" } })
		);
		assert.strictEqual(enabled.think, true);

		const unset = api.prepareRequestBody(
			{ model: "ollama-test-model", messages: [], stream: true },
			model({})
		);
		assert.strictEqual("think" in unset, false);
	});

	test("sends the configured discovery key except for the local sentinel", async () => {
		const originalFetch = globalThis.fetch;
		const authorizationHeaders: Array<string | null> = [];
		globalThis.fetch = (async (_input, init) => {
			authorizationHeaders.push(new Headers(init?.headers).get("Authorization"));
			return jsonResponse({ models: [{ name: "llama3.2:latest", model: "llama3.2:latest" }] });
		}) as typeof fetch;

		try {
			await fetchOllamaModels("https://ollama.example.test", "secret-key");
			await fetchOllamaModels("https://ollama.example.test", "ollama");
		} finally {
			globalThis.fetch = originalFetch;
		}

		assert.deepStrictEqual(authorizationHeaders, ["Bearer secret-key", null]);
	});

	test("emits usage from the final native stream chunk", async () => {
		const api = new OllamaApi("ollama-usage-model");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						`${JSON.stringify({
							model: "ollama-usage-model",
							created_at: "2026-08-11T00:00:00Z",
							message: { role: "assistant", content: "answer" },
							done: true,
							prompt_eval_count: 90,
							eval_count: 10,
						})}\n`
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
			prompt_tokens: 90,
			completion_tokens: 10,
			total_tokens: 100,
			prompt_tokens_details: { cached_tokens: 0 },
		});
	});

	test("processes a final line that has no trailing newline", async () => {
		const api = new OllamaApi("ollama-final-line");
		const parts: vscode.LanguageModelResponsePart2[] = [];
		const stream = streamFrom([
			JSON.stringify({
				model: "ollama-final-line",
				created_at: "2026-08-11T00:00:00Z",
				message: { role: "assistant", content: "final" },
				done: true,
			}),
		]);

		await api.processStreamingResponse(stream, { report: (part) => parts.push(part) }, cancellationToken());

		assert.ok(parts.some((part) => part instanceof vscode.LanguageModelTextPart && part.value === "final"));
	});

	test("rejects an in-stream provider error after HTTP 200", async () => {
		const api = new OllamaApi("ollama-error");
		const stream = streamFrom([
			`${JSON.stringify({ model: "ollama-error", created_at: "2026-08-11T00:00:00Z", error: "model overloaded" })}\n`,
		]);

		await assert.rejects(
			() => api.processStreamingResponse(stream, { report() {} }, cancellationToken()),
			/model overloaded/u
		);
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return { id: "ollama-test-model", owned_by: "ollama", ...overrides };
}

function streamFrom(chunks: readonly string[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(new TextEncoder().encode(chunk));
			}
			controller.close();
		},
	});
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function cancellationToken(): vscode.CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	} as unknown as vscode.CancellationToken;
}

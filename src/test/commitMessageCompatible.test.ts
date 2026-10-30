import * as assert from "assert";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as vscode from "vscode";

import { generateCommitMsg } from "../gitCommit/commitMessageGenerator";
import { logger } from "../logger";

/**
 * Commit generation runs outside the chat request path, so it needs its own routing coverage:
 * a compatible model must reach `OpenaiCompatibleApi` instead of the default OpenAI adapter.
 */
suite("commit message generation with OpenAI Compatible models", () => {
	let repoDir: string;
	let captured: Array<{ url: string; body: Record<string, unknown> }>;
	let errors: string[];
	let configuration: Record<string, unknown>;

	const originalFetch = globalThis.fetch;
	const originalConfig = vscode.workspace.getConfiguration;
	const originalGetExtension = vscode.extensions.getExtension;
	const originalWithProgress = vscode.window.withProgress;
	const originalShowErrorMessage = vscode.window.showErrorMessage;
	const originalShowInformationMessage = vscode.window.showInformationMessage;
	const originalExecuteCommand = vscode.commands.executeCommand;
	const originalLogDebug = logger.debug;

	setup(() => {
		repoDir = mkdtempSync(path.join(tmpdir(), "oaiproxy-commit-"));
		execFileSync("git", ["init", "-q"], { cwd: repoDir });
		execFileSync("git", ["config", "user.email", "oaiproxy@example.com"], { cwd: repoDir });
		execFileSync("git", ["config", "user.name", "OAIProxy Test"], { cwd: repoDir });
		writeFileSync(path.join(repoDir, "file.txt"), "one\n");
		execFileSync("git", ["add", "file.txt"], { cwd: repoDir });
		execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
		writeFileSync(path.join(repoDir, "file.txt"), "one\ntwo\n");

		captured = [];
		errors = [];
		configuration = {
			"oaicopilot.models": [
				{
					id: "gpt-6-astra",
					configId: "openai-compatible",
					owned_by: "openai-compatible",
					baseUrl: "https://gateway.example.com/v1",
					apiMode: "openai-compatible",
					context_length: 258000,
					max_tokens: 128000,
					max_completion_tokens: 4096,
					temperature: 0.3,
					top_p: 0.9,
					reasoning_effort: "xhigh",
					prompt_cache: { enabled: true },
					useForCommitGeneration: true,
				},
			],
			"oaicopilot.commitLanguage": "English",
			"oaicopilot.retry": { enabled: false },
		};

		const repository = { rootUri: { fsPath: repoDir }, inputBox: { value: "" } };
		(vscode.extensions as unknown as { getExtension: unknown }).getExtension = (id: string) =>
			id === "vscode.git"
				? { exports: { getAPI: () => ({ repositories: [repository], getRepository: () => repository }) } }
				: undefined;
		(vscode.window as unknown as { withProgress: unknown }).withProgress = async (
			_options: unknown,
			task: (progress: unknown, token: vscode.CancellationToken) => Promise<unknown>
		) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token);
		vscode.window.showErrorMessage = async (message: string) => {
			errors.push(message);
			return undefined;
		};
		vscode.window.showInformationMessage = async () => undefined;
		(vscode.commands as unknown as { executeCommand: unknown }).executeCommand = async () => undefined;
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => configuration[key] ?? fallback,
		})) as typeof originalConfig;
		logger.debug = () => undefined;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			captured.push({
				url: String(url),
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			});
			return new Response(
				`data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "feat: add a file" } }] })}\n\n` +
					`data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 32, completion_tokens: 5, total_tokens: 37 } })}\n\n` +
					"data: [DONE]\n\n",
				{ status: 200, headers: { "Content-Type": "text/event-stream" } }
			);
		}) as typeof fetch;
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
		vscode.workspace.getConfiguration = originalConfig;
		(vscode.extensions as unknown as { getExtension: unknown }).getExtension = originalGetExtension;
		(vscode.window as unknown as { withProgress: unknown }).withProgress = originalWithProgress;
		vscode.window.showErrorMessage = originalShowErrorMessage;
		vscode.window.showInformationMessage = originalShowInformationMessage;
		(vscode.commands as unknown as { executeCommand: unknown }).executeCommand = originalExecuteCommand;
		logger.debug = originalLogDebug;
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("uses the compatible request shape for a compatible commit model", async () => {
		await generateCommitMsg(
			{
				get: async (key: string) =>
					key === "oaicopilot.apiKey.openai-compatible" ? "local-test-only" : undefined,
			} as unknown as vscode.SecretStorage,
			{ get: () => [] } as unknown as vscode.Memento,
			{ rootUri: { fsPath: repoDir } } as unknown as vscode.SourceControl
		);

		assert.deepStrictEqual(errors, [], "commit generation reported an error");
		assert.strictEqual(captured.length, 1);
		const [{ url, body }] = captured;
		assert.ok(url.endsWith("/chat/completions"), url);
		assert.strictEqual(body.model, "gpt-6-astra");
		assert.strictEqual(body.max_tokens, 128000);
		assert.strictEqual(body.max_completion_tokens, undefined);
		assert.strictEqual(body.reasoning_effort, "xhigh");
		assert.strictEqual(body.reasoning, undefined);
		assert.strictEqual(body.thinking, undefined);
		assert.strictEqual(body.temperature, undefined, "Astra sampling controls must be pruned");
		assert.strictEqual(body.top_p, undefined);
		assert.strictEqual(typeof body.prompt_cache_key, "string");
		assert.ok((body.prompt_cache_key as string).startsWith("oaiproxy-cc-"));
	});
});

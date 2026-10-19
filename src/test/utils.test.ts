import * as assert from "assert";
import * as vscode from "vscode";
import { executeWithRetry } from "../utils";

suite("utils", () => {
	test("rejects before invoking the operation when the token is already cancelled", async () => {
		let calls = 0;
		const token = cancellationToken(true);

		await assert.rejects(
			executeWithRetry(
				async () => {
					calls += 1;
					return "unexpected";
				},
				{ enabled: true, max_attempts: 3, interval_ms: 1 },
				token
			),
			(error: Error) => error instanceof vscode.CancellationError
		);
		assert.strictEqual(calls, 0);
	});

	test("interrupts retry backoff when the token is cancelled", async () => {
		const source = new vscode.CancellationTokenSource();
		let calls = 0;
		const promise = executeWithRetry(
			async () => {
				calls += 1;
				throw new Error("upstream failed [503]");
			},
			{ enabled: true, max_attempts: 3, interval_ms: 60_000 },
			source.token
		);

		setTimeout(() => source.cancel(), 10);
		const started = Date.now();
		await assert.rejects(promise, (error: Error) => error instanceof vscode.CancellationError);
		assert.ok(Date.now() - started < 5_000, "cancellation must not wait for the retry interval");
		assert.strictEqual(calls, 1);
	});
});

function cancellationToken(cancelled: boolean): vscode.CancellationToken {
	return {
		isCancellationRequested: cancelled,
		onCancellationRequested: () => ({ dispose() {} }),
	} as unknown as vscode.CancellationToken;
}

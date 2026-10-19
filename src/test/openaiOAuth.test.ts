import * as assert from "assert";
import {
	OPENAI_CODEX_RESPONSES_BASE_URL,
	OPENAI_OAUTH_CLIENT_ID,
	OPENAI_OAUTH_DEVICE_CODE_URL,
	OPENAI_OAUTH_DEVICE_TOKEN_URL,
	OPENAI_OAUTH_TOKEN_URL,
	OPENAI_OAUTH_VERIFICATION_URL,
	applyOpenAICodexOAuthHeaders,
	applyOpenAICodexSessionHeaders,
	clearOpenAIOAuthCredential,
	getOpenAIOAuthAccessToken,
	getOpenAIOAuthCredential,
	isOpenAICodexOAuthBaseUrl,
	isOpenAICodexOAuthProvider,
	loginOpenAIOAuth,
} from "../openaiOAuth";
import type { SecretStorageLike } from "../xaiOAuth";

suite("openaiOAuth", () => {
	test("recognizes the Codex route and adds account attribution headers", () => {
		assert.strictEqual(OPENAI_CODEX_RESPONSES_BASE_URL, "https://chatgpt.com/backend-api/codex");
		assert.strictEqual(isOpenAICodexOAuthBaseUrl("https://chatgpt.com/backend-api/codex"), true);
		assert.strictEqual(isOpenAICodexOAuthBaseUrl("https://api.openai.com/v1"), false);
		const headers: Record<string, string> = { Authorization: "Bearer oauth-token" };
		applyOpenAICodexOAuthHeaders(headers, { accountId: "acct-test" });
		assert.deepStrictEqual(headers, {
			Authorization: "Bearer oauth-token",
			"OpenAI-Beta": "responses=experimental",
			Accept: "text/event-stream",
			originator: "codex_cli_rs",
			version: "oaiproxy",
			"User-Agent": "oaiproxy",
			"ChatGPT-Account-Id": "acct-test",
		});
		applyOpenAICodexSessionHeaders(headers, "cache-session");
		assert.strictEqual((headers as Record<string, string>).session_id, "cache-session");
		assert.strictEqual((headers as Record<string, string>)["x-client-request-id"], "cache-session");
	});

	test("completes the OpenAI device-code flow", async () => {
		const calls: { url: string; body: string; headers: Headers }[] = [];
		let polls = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			const body = typeof init?.body === "string" ? init.body : "";
			calls.push({ url, body, headers: new Headers(init?.headers) });
			if (url === OPENAI_OAUTH_DEVICE_CODE_URL) {
				return jsonResponse({ device_auth_id: "device-auth-id", user_code: "ABCD-1234", interval: 0.001 });
			}
			if (url === OPENAI_OAUTH_DEVICE_TOKEN_URL) {
				polls += 1;
				return polls === 1
					? jsonResponse({}, 403)
					: jsonResponse({ authorization_code: "authorization-code", code_verifier: "code-verifier" });
			}
			assert.strictEqual(url, OPENAI_OAUTH_TOKEN_URL);
			return jsonResponse({
				access_token: jwt({ email: "user@example.com", name: "OpenAI User", "https://api.openai.com/auth": { chatgpt_account_id: "acct-test" } }),
				refresh_token: "refresh-token",
				expires_in: 3600,
			});
		};

		let code = "";
		const credential = await loginOpenAIOAuth({
			fetchImpl,
			onDeviceCode: (info) => {
				code = info.userCode;
				assert.strictEqual(info.verificationUri, OPENAI_OAUTH_VERIFICATION_URL);
			},
		});

		assert.strictEqual(code, "ABCD-1234");
		assert.strictEqual(credential.email, "user@example.com");
		assert.strictEqual(credential.accountId, "acct-test");
		assert.strictEqual(calls.length, 4);
		assert.deepStrictEqual(calls.map((call) => call.url), [
			OPENAI_OAUTH_DEVICE_CODE_URL,
			OPENAI_OAUTH_DEVICE_TOKEN_URL,
			OPENAI_OAUTH_DEVICE_TOKEN_URL,
			OPENAI_OAUTH_TOKEN_URL,
		]);
		for (const call of calls) {
			assert.strictEqual(call.headers.get("originator"), "codex_cli_rs");
			assert.strictEqual(call.headers.get("version"), "oaiproxy");
			assert.strictEqual(call.headers.get("User-Agent"), "oaiproxy");
			assert.strictEqual(call.headers.get("Accept"), "application/json");
			assert.strictEqual(
				call.headers.get("Content-Type"),
				call.url === OPENAI_OAUTH_TOKEN_URL ? "application/x-www-form-urlencoded" : "application/json"
			);
		}
		assert.deepStrictEqual(JSON.parse(calls[0].body), { client_id: OPENAI_OAUTH_CLIENT_ID });
		assert.strictEqual(calls[3].body, "grant_type=authorization_code&code=authorization-code&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback&client_id=app_EMoamEEZ73f0CkXaXp7hrann&code_verifier=code-verifier");
	});

	test("refreshes an expired credential once and preserves the account id", async () => {
		let stored = JSON.stringify({
			accessToken: "expired-token",
			refreshToken: "refresh-token",
			expiresAt: 1,
			accountId: "acct-test",
		});
		const secrets: SecretStorageLike = {
			get: async () => stored,
			store: async (_key: string, value: string) => {
				stored = value;
			},
			delete: async () => undefined,
		};
		let refreshCount = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			refreshCount += 1;
			assert.strictEqual(String(input), OPENAI_OAUTH_TOKEN_URL);
			const headers = new Headers(init?.headers);
			assert.strictEqual(headers.get("originator"), "codex_cli_rs");
			assert.strictEqual(headers.get("version"), "oaiproxy");
			assert.strictEqual(headers.get("User-Agent"), "oaiproxy");
			assert.strictEqual(headers.get("Accept"), "application/json");
			assert.strictEqual(headers.get("Content-Type"), "application/x-www-form-urlencoded");
			assert.strictEqual(init?.body, "grant_type=refresh_token&refresh_token=refresh-token&client_id=app_EMoamEEZ73f0CkXaXp7hrann");
			return jsonResponse({ access_token: "fresh-token", expires_in: 3600 });
		};

		const [first, second] = await Promise.all([
			getOpenAIOAuthAccessToken(secrets, { now: 10_000, fetchImpl }),
			getOpenAIOAuthAccessToken(secrets, { now: 10_000, fetchImpl }),
		]);
		assert.strictEqual(first, "fresh-token");
		assert.strictEqual(second, "fresh-token");
		assert.strictEqual(refreshCount, 1);
		const refreshed = await getOpenAIOAuthCredential(secrets, { now: 10_000 });
		assert.ok(refreshed);
		assert.strictEqual(refreshed.accountId, "acct-test");
	});

	test("distinguishes the API-key provider from Codex OAuth", () => {
		assert.strictEqual(isOpenAICodexOAuthProvider("openai"), false);
		assert.strictEqual(
			isOpenAICodexOAuthProvider("openai", "api-key", "https://api.openai.com/v1"),
			false
		);
		assert.strictEqual(isOpenAICodexOAuthProvider("openai-oauth"), true);
		assert.strictEqual(
			isOpenAICodexOAuthProvider("openai", "oauth", OPENAI_CODEX_RESPONSES_BASE_URL),
			true
		);
	});

	test("does not restore a credential after sign-out during an in-flight refresh", async () => {
		let stored: string | undefined = JSON.stringify({
			accessToken: "expired-token",
			refreshToken: "refresh-token",
			expiresAt: 1,
		});
		const secrets: SecretStorageLike = {
			get: async () => stored,
			store: async (_key, value) => {
				stored = value;
			},
			delete: async () => {
				stored = undefined;
			},
		};
		const started = deferred<void>();
		const response = deferred<Response>();
		const pending = getOpenAIOAuthAccessToken(secrets, {
			now: 10_000,
			fetchImpl: async () => {
				started.resolve();
				return await response.promise;
			},
		});

		await started.promise;
		await clearOpenAIOAuthCredential(secrets);
		response.resolve(jsonResponse({ access_token: "fresh-token", expires_in: 3600 }));

		assert.strictEqual(await pending, "fresh-token");
		assert.strictEqual(stored, undefined);
	});

	test("does not persist a refresh when sign-out completes during the credential load", async () => {
		let stored: string | undefined = JSON.stringify({
			accessToken: "expired-token",
			refreshToken: "refresh-token",
			expiresAt: 1,
		});
		let getCalls = 0;
		const loadStarted = deferred<void>();
		const loadResult = deferred<string | undefined>();
		const secrets: SecretStorageLike = {
			get: async () => {
				getCalls += 1;
				if (getCalls === 1) {
					loadStarted.resolve();
					return await loadResult.promise;
				}
				return stored;
			},
			store: async (_key, value) => {
				stored = value;
			},
			delete: async () => {
				stored = undefined;
			},
		};
		let refreshCount = 0;
		const pending = getOpenAIOAuthAccessToken(secrets, {
			now: 10_000,
			fetchImpl: async () => {
				refreshCount += 1;
				return jsonResponse({ access_token: "fresh-token", expires_in: 3600 });
			},
		});

		await loadStarted.promise;
		await clearOpenAIOAuthCredential(secrets);
		loadResult.resolve(
			JSON.stringify({ accessToken: "expired-token", refreshToken: "refresh-token", expiresAt: 1 })
		);

		assert.strictEqual(await pending, "fresh-token");
		assert.strictEqual(refreshCount, 1);
		assert.strictEqual(stored, undefined);
	});

	test("a cancelled caller does not abort a shared refresh used by another caller", async () => {
		let stored: string | undefined = JSON.stringify({
			accessToken: "expired-token",
			refreshToken: "refresh-token",
			expiresAt: 1,
		});
		const secrets: SecretStorageLike = {
			get: async () => stored,
			store: async (_key, value) => {
				stored = value;
			},
			delete: async () => {
				stored = undefined;
			},
		};
		const started = deferred<void>();
		const response = deferred<Response>();
		let refreshCount = 0;
		const controller = new AbortController();
		const cancelled = getOpenAIOAuthAccessToken(secrets, {
			now: 10_000,
			signal: controller.signal,
			fetchImpl: async () => {
				refreshCount += 1;
				started.resolve();
				return await response.promise;
			},
		});

		await started.promise;
		const survivor = getOpenAIOAuthAccessToken(secrets, {
			now: 10_000,
			fetchImpl: async () => {
				throw new Error("the in-flight refresh should be reused");
			},
		});
		controller.abort(new Error("first caller cancelled"));
		response.resolve(jsonResponse({ access_token: "fresh-token", expires_in: 3600 }));

		await assert.rejects(cancelled, /first caller cancelled/u);
		assert.strictEqual(await survivor, "fresh-token");
		assert.strictEqual(refreshCount, 1);
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function jwt(payload: Record<string, unknown>): string {
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function jsonResponse(value: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

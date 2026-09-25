import * as assert from "assert";
import {
	OPENAI_CODEX_RESPONSES_BASE_URL,
	OPENAI_OAUTH_CLIENT_ID,
	OPENAI_OAUTH_DEVICE_CODE_URL,
	OPENAI_OAUTH_DEVICE_TOKEN_URL,
	OPENAI_OAUTH_TOKEN_URL,
	OPENAI_OAUTH_VERIFICATION_URL,
	applyOpenAICodexOAuthHeaders,
	getOpenAIOAuthAccessToken,
	getOpenAIOAuthCredential,
	isOpenAICodexOAuthBaseUrl,
	loginOpenAIOAuth,
} from "../openaiOAuth";
import type { SecretStorageLike } from "../xaiOAuth";

suite("openaiOAuth", () => {
	test("recognizes the Codex route and adds account attribution headers", () => {
		assert.strictEqual(OPENAI_CODEX_RESPONSES_BASE_URL, "https://chatgpt.com/backend-api/codex");
		assert.strictEqual(isOpenAICodexOAuthBaseUrl("https://chatgpt.com/backend-api/codex"), true);
		assert.strictEqual(isOpenAICodexOAuthBaseUrl("https://api.openai.com/v1"), false);
		const headers: Record<string, string> = {};
		applyOpenAICodexOAuthHeaders(headers, { accountId: "acct-test" });
		assert.deepStrictEqual(headers, {
			originator: "oaiproxy",
			version: "oaiproxy",
			"User-Agent": "oaiproxy",
			"ChatGPT-Account-Id": "acct-test",
		});
	});

	test("completes the OpenAI device-code flow", async () => {
		const calls: { url: string; body: string }[] = [];
		let polls = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			const body = typeof init?.body === "string" ? init.body : "";
			calls.push({ url, body });
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
		const fetchImpl: typeof fetch = async () => {
			refreshCount += 1;
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
});

function jwt(payload: Record<string, unknown>): string {
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function jsonResponse(value: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

import * as assert from "assert";
import {
	XAI_OAUTH_DISCOVERY_URL,
	XAI_OAUTH_CLIENT_ID,
	XAI_OAUTH_SCOPE,
	XAI_GROK_OAUTH_BASE_URL,
	XAI_GROK_OAUTH_CLIENT_VERSION,
	applyXaiGrokOAuthHeaders,
	getXaiOAuthAccessToken,
	loginXaiOAuth,
	type SecretStorageLike,
} from "../xaiOAuth";

suite("xaiOAuth", () => {
	test("adds the Grok CLI compatibility headers required by the subscription proxy", () => {
		const headers: Record<string, string> = {};
		applyXaiGrokOAuthHeaders(headers, "grok-4-fast");

		assert.deepStrictEqual(headers, {
			"X-XAI-Token-Auth": "xai-grok-cli",
			"x-grok-client-version": XAI_GROK_OAUTH_CLIENT_VERSION,
			"x-grok-model-override": "grok-4-fast",
		});
	});

	test("completes device-code login and returns a refreshable credential", async () => {
		const calls: { url: string; body: string }[] = [];
		let tokenPolls = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			const body = typeof init?.body === "string" ? init.body : "";
			calls.push({ url, body });
			if (url === XAI_OAUTH_DISCOVERY_URL) {
				return jsonResponse({
					token_endpoint: "https://auth.x.ai/oauth2/token",
					device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
				});
			}
			if (url.endsWith("/device/code")) {
				return jsonResponse({
					device_code: "device-code",
					user_code: "ABCD-1234",
					verification_uri: "https://accounts.x.ai/oauth2/device",
					expires_in: 60,
					interval: 0.001,
				});
			}
			tokenPolls += 1;
			if (tokenPolls === 1) {
				return jsonResponse({ error: "authorization_pending" }, 400);
			}
			return jsonResponse({
				access_token: "access-token",
				refresh_token: "refresh-token",
				expires_in: 3600,
			});
		};

		let deviceCode = "";
		const credential = await loginXaiOAuth({
			fetchImpl,
			onDeviceCode: (info) => {
				deviceCode = info.userCode;
			},
		});

		assert.strictEqual(deviceCode, "ABCD-1234");
		assert.strictEqual(credential.accessToken, "access-token");
		assert.strictEqual(credential.refreshToken, "refresh-token");
		assert.strictEqual(calls[1]?.body, new URLSearchParams({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }).toString());
		assert.strictEqual(calls.at(-1)?.body, "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&client_id=b1a00492-073a-47ea-816f-4c329264a828&device_code=device-code");
		assert.strictEqual(XAI_GROK_OAUTH_BASE_URL, "https://cli-chat-proxy.grok.com/v1");
	});

	test("refreshes an expired credential once and shares the refreshed access token", async () => {
		let stored = JSON.stringify({
			accessToken: "expired-token",
			refreshToken: "refresh-token",
			tokenEndpoint: "https://auth.x.ai/oauth2/token",
			expiresAt: 1,
		});
		const secrets: SecretStorageLike = {
			get: async () => stored,
			store: async (_key, value) => {
				stored = value;
			},
			delete: async () => undefined,
		};
		let refreshCount = 0;
		const fetchImpl: typeof fetch = async (_input, init) => {
			refreshCount += 1;
			assert.strictEqual(init?.method, "POST");
			return jsonResponse({ access_token: "fresh-token", refresh_token: "rotated-refresh", expires_in: 3600 });
		};

		const [first, second] = await Promise.all([
			getXaiOAuthAccessToken(secrets, { now: 10_000, fetchImpl }),
			getXaiOAuthAccessToken(secrets, { now: 10_000, fetchImpl }),
		]);
		assert.strictEqual(first, "fresh-token");
		assert.strictEqual(second, "fresh-token");
		assert.strictEqual(refreshCount, 1);
		assert.strictEqual(JSON.parse(stored).refreshToken, "rotated-refresh");
	});
});

function jsonResponse(value: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

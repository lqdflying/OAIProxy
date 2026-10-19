import * as assert from "assert";
import {
	XAI_OAUTH_DISCOVERY_URL,
	XAI_OAUTH_CLIENT_ID,
	XAI_OAUTH_SCOPE,
	XAI_GROK_OAUTH_BASE_URL,
	applyXaiGrokOAuthHeaders,
	clearXaiOAuthCredential,
	getXaiOAuthAccessToken,
	loginXaiOAuth,
	refreshXaiOAuthCredential,
	type SecretStorageLike,
} from "../xaiOAuth";

suite("xaiOAuth", () => {
	test("adds the Grok CLI compatibility headers required by the subscription proxy", () => {
		const headers: Record<string, string> = {};
		applyXaiGrokOAuthHeaders(headers, "grok-4-fast");

		assert.deepStrictEqual(headers, {
			"X-XAI-Token-Auth": "xai-grok-cli",
			"x-grok-client-version": "1.0.13",
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

	test("does not restore a credential after sign-out during an in-flight refresh", async () => {
		let stored: string | undefined = JSON.stringify({
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
			delete: async () => {
				stored = undefined;
			},
		};
		const started = deferred<void>();
		const response = deferred<Response>();
		const pending = getXaiOAuthAccessToken(secrets, {
			now: 10_000,
			fetchImpl: async () => {
				started.resolve();
				return await response.promise;
			},
		});

		await started.promise;
		await clearXaiOAuthCredential(secrets);
		response.resolve(jsonResponse({ access_token: "fresh-token", refresh_token: "rotated-token", expires_in: 3600 }));

		assert.strictEqual(await pending, "fresh-token");
		assert.strictEqual(stored, undefined);
	});

	test("forwards caller cancellation to an in-flight refresh request", async () => {
		const started = deferred<void>();
		const controller = new AbortController();
		const pending = refreshXaiOAuthCredential(
			{
				accessToken: "expired-token",
				refreshToken: "refresh-token",
				tokenEndpoint: "https://auth.x.ai/oauth2/token",
				expiresAt: 1,
			},
			{
				signal: controller.signal,
				fetchImpl: async (_input, init) => {
					started.resolve();
					return await new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
					});
				},
			}
		);

		await started.promise;
		controller.abort(new Error("caller stopped the request"));
		await assert.rejects(pending, /caller stopped the request/u);
	});

	test("rejects an OAuth response body above the 256 KiB limit", async () => {
		await assert.rejects(
			refreshXaiOAuthCredential(
				{
					accessToken: "expired-token",
					refreshToken: "refresh-token",
					tokenEndpoint: "https://auth.x.ai/oauth2/token",
					expiresAt: 1,
				},
				{
					fetchImpl: async () => new Response(new Uint8Array(256 * 1024 + 1)),
				}
			),
			/exceeded the 256 KiB limit/u
		);
	});

	test("does not persist a refresh when sign-out completes during the credential load", async () => {
		let stored: string | undefined = JSON.stringify({
			accessToken: "expired-token",
			refreshToken: "refresh-token",
			tokenEndpoint: "https://auth.x.ai/oauth2/token",
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
		const pending = getXaiOAuthAccessToken(secrets, {
			now: 10_000,
			fetchImpl: async () => {
				refreshCount += 1;
				return jsonResponse({ access_token: "fresh-token", refresh_token: "rotated-token", expires_in: 3600 });
			},
		});

		await loadStarted.promise;
		await clearXaiOAuthCredential(secrets);
		loadResult.resolve(
			JSON.stringify({
				accessToken: "expired-token",
				refreshToken: "refresh-token",
				tokenEndpoint: "https://auth.x.ai/oauth2/token",
				expiresAt: 1,
			})
		);

		assert.strictEqual(await pending, "fresh-token");
		assert.strictEqual(refreshCount, 1);
		assert.strictEqual(stored, undefined);
	});

	test("a cancelled caller does not abort a shared refresh used by another caller", async () => {
		let stored: string | undefined = JSON.stringify({
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
			delete: async () => {
				stored = undefined;
			},
		};
		const started = deferred<void>();
		const response = deferred<Response>();
		let refreshCount = 0;
		const controller = new AbortController();
		const cancelled = getXaiOAuthAccessToken(secrets, {
			now: 10_000,
			signal: controller.signal,
			fetchImpl: async () => {
				refreshCount += 1;
				started.resolve();
				return await response.promise;
			},
		});

		await started.promise;
		const survivor = getXaiOAuthAccessToken(secrets, {
			now: 10_000,
			fetchImpl: async () => {
				throw new Error("the in-flight refresh should be reused");
			},
		});
		controller.abort(new Error("first caller cancelled"));
		response.resolve(jsonResponse({ access_token: "fresh-token", refresh_token: "rotated-token", expires_in: 3600 }));

		await assert.rejects(cancelled, /first caller cancelled/u);
		assert.strictEqual(await survivor, "fresh-token");
		assert.strictEqual(refreshCount, 1);
	});

	test("rejects a request started with an already-aborted caller signal", async () => {
		const controller = new AbortController();
		controller.abort(new Error("caller stopped before start"));
		let fetchCalls = 0;

		await assert.rejects(
			refreshXaiOAuthCredential(
				{
					accessToken: "expired-token",
					refreshToken: "refresh-token",
					tokenEndpoint: "https://auth.x.ai/oauth2/token",
					expiresAt: 1,
				},
				{
					signal: controller.signal,
					fetchImpl: async (_input, init) => {
						fetchCalls += 1;
						if (init?.signal?.aborted) {
							throw init.signal.reason;
						}
						return jsonResponse({ access_token: "unexpected-token", expires_in: 3600 });
					},
				}
			),
			/caller stopped before start/u
		);
		assert.strictEqual(fetchCalls, 1);
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function jsonResponse(value: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

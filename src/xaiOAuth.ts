/**
 * xAI/Grok subscription OAuth support.
 *
 * The flow mirrors the device-code contract used by OpenClaw's bundled xAI
 * provider, while keeping credentials in OAIProxy's own SecretStorage entry.
 */

export const XAI_OAUTH_SECRET_KEY = "oaicopilot.oauth.xai";
export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const XAI_GROK_OAUTH_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
// The subscription proxy's HTTP 426 response requires at least 1.0.13 (2026-10-02).
// Released CLI version: https://x.ai/build/changelog
// Keep this independent from the OAIProxy extension version, which is not a Grok CLI version.
export const XAI_GROK_OAUTH_CLIENT_VERSION = "1.0.13";

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;
const EXPIRY_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_MAX_BYTES = 256 * 1024;

export interface XaiOAuthCredential {
	accessToken: string;
	refreshToken: string;
	tokenEndpoint: string;
	expiresAt: number;
	email?: string;
	displayName?: string;
}

export interface SecretStorageLike {
	get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
	store(key: string, value: string): Thenable<void> | Promise<void>;
	delete(key: string): Thenable<void> | Promise<void>;
}

export interface XaiOAuthDeviceCodeInfo {
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInMs: number;
}

export interface XaiOAuthLoginOptions {
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	onDeviceCode?: (info: XaiOAuthDeviceCodeInfo) => void | Promise<void>;
}

interface OAuthDiscoveryDocument {
	tokenEndpoint: string;
	deviceAuthorizationEndpoint: string;
}

interface OAuthTokenResponse {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	email?: string;
	displayName?: string;
}

const refreshPromises = new WeakMap<SecretStorageLike, Promise<XaiOAuthCredential>>();
const credentialGenerations = new WeakMap<SecretStorageLike, number>();
const credentialOperationQueues = new WeakMap<SecretStorageLike, Promise<void>>();

function getCredentialGeneration(secrets: SecretStorageLike): number {
	return credentialGenerations.get(secrets) ?? 0;
}

function advanceCredentialGeneration(secrets: SecretStorageLike): void {
	credentialGenerations.set(secrets, getCredentialGeneration(secrets) + 1);
}

function queueCredentialOperation<T>(secrets: SecretStorageLike, operation: () => Promise<T>): Promise<T> {
	const previous = credentialOperationQueues.get(secrets) ?? Promise.resolve();
	const result = previous.catch(() => undefined).then(operation);
	credentialOperationQueues.set(
		secrets,
		result.then(
			() => undefined,
			() => undefined
		)
	);
	return result;
}

export function isXaiGrokOAuthBaseUrl(baseUrl: string | undefined): boolean {
	if (!baseUrl) {
		return false;
	}
	try {
		return new URL(baseUrl).href.replace(/\/+$/u, "") === XAI_GROK_OAUTH_BASE_URL;
	} catch {
		return false;
	}
}

export function applyXaiGrokOAuthHeaders(headers: Record<string, string>, modelId: string): void {
	headers["X-XAI-Token-Auth"] = "xai-grok-cli";
	headers["x-grok-client-version"] = XAI_GROK_OAUTH_CLIENT_VERSION;
	headers["x-grok-model-override"] = modelId;
}

export async function loadXaiOAuthCredential(secrets: SecretStorageLike): Promise<XaiOAuthCredential | undefined> {
	const raw = await secrets.get(XAI_OAUTH_SECRET_KEY);
	if (!raw) {
		return undefined;
	}
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof value.accessToken !== "string" ||
			typeof value.refreshToken !== "string" ||
			typeof value.tokenEndpoint !== "string" ||
			typeof value.expiresAt !== "number" ||
			!isTrustedXaiOAuthEndpoint(value.tokenEndpoint)
		) {
			return undefined;
		}
		return {
			accessToken: value.accessToken,
			refreshToken: value.refreshToken,
			tokenEndpoint: value.tokenEndpoint,
			expiresAt: value.expiresAt,
			...(typeof value.email === "string" ? { email: value.email } : {}),
			...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
		};
	} catch {
		return undefined;
	}
}

export async function saveXaiOAuthCredential(
	secrets: SecretStorageLike,
	credential: XaiOAuthCredential
): Promise<void> {
	await queueCredentialOperation(secrets, async () => {
		advanceCredentialGeneration(secrets);
		await secrets.store(XAI_OAUTH_SECRET_KEY, JSON.stringify(credential));
	});
}

export async function clearXaiOAuthCredential(secrets: SecretStorageLike): Promise<void> {
	await queueCredentialOperation(secrets, async () => {
		advanceCredentialGeneration(secrets);
		await secrets.delete(XAI_OAUTH_SECRET_KEY);
	});
}

async function persistRefreshedCredentialIfCurrent(
	secrets: SecretStorageLike,
	refreshed: XaiOAuthCredential,
	generation: number
): Promise<XaiOAuthCredential> {
	return await queueCredentialOperation(secrets, async () => {
		if (getCredentialGeneration(secrets) !== generation) {
			return (await loadXaiOAuthCredential(secrets)) ?? refreshed;
		}
		advanceCredentialGeneration(secrets);
		await secrets.store(XAI_OAUTH_SECRET_KEY, JSON.stringify(refreshed));
		return refreshed;
	});
}

function getOrStartRefresh(
	secrets: SecretStorageLike,
	credential: XaiOAuthCredential,
	options: { now?: number; signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<XaiOAuthCredential> {
	const existing = refreshPromises.get(secrets);
	if (existing) {
		return existing;
	}
	const generation = getCredentialGeneration(secrets);
	const promise = refreshXaiOAuthCredential(credential, options)
		.then((refreshed) => persistRefreshedCredentialIfCurrent(secrets, refreshed, generation));
	refreshPromises.set(secrets, promise);
	void promise
		.finally(() => {
			if (refreshPromises.get(secrets) === promise) {
				refreshPromises.delete(secrets);
			}
		})
		.catch(() => undefined);
	return promise;
}

export async function getXaiOAuthAccessToken(
	secrets: SecretStorageLike,
	options: { now?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<string | undefined> {
	const credential = await loadXaiOAuthCredential(secrets);
	if (!credential) {
		return undefined;
	}

	const now = options.now ?? Date.now();
	if (credential.expiresAt > now + EXPIRY_SKEW_MS) {
		return credential.accessToken;
	}

	return (await getOrStartRefresh(secrets, credential, options)).accessToken;
}

export async function discoverXaiOAuth(
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<OAuthDiscoveryDocument> {
	const json = await requestJson(XAI_OAUTH_DISCOVERY_URL, options);
	const tokenEndpoint = requireTrustedEndpoint(json.token_endpoint, "token endpoint");
	const deviceAuthorizationEndpoint = requireTrustedEndpoint(
		json.device_authorization_endpoint,
		"device authorization endpoint"
	);
	return { tokenEndpoint, deviceAuthorizationEndpoint };
}

export async function loginXaiOAuth(options: XaiOAuthLoginOptions = {}): Promise<XaiOAuthCredential> {
	const discovery = await discoverXaiOAuth(options);
	const deviceResponse = await requestJson(
		discovery.deviceAuthorizationEndpoint,
		options,
		{ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }
	);

	const deviceCode = requireString(deviceResponse.device_code, "device_code");
	const userCode = requireString(deviceResponse.user_code, "user_code");
	const verificationUri = requireTrustedEndpoint(
		requireString(deviceResponse.verification_uri, "verification_uri"),
		"verification URI"
	);
	const verificationUriComplete =
		typeof deviceResponse.verification_uri_complete === "string"
			? requireTrustedEndpoint(deviceResponse.verification_uri_complete, "complete verification URI")
			: undefined;
	const expiresInMs = positiveMilliseconds(deviceResponse.expires_in) ?? 5 * 60_000;
	let intervalMs = positiveMilliseconds(deviceResponse.interval) ?? DEFAULT_POLL_INTERVAL_MS;

	await options.onDeviceCode?.({ userCode, verificationUri, verificationUriComplete, expiresInMs });

	const deadline = Date.now() + expiresInMs;
	while (Date.now() < deadline) {
		const response = await requestJsonResponse(
			discovery.tokenEndpoint,
			options,
			{
				grant_type: DEVICE_CODE_GRANT_TYPE,
				client_id: XAI_OAUTH_CLIENT_ID,
				device_code: deviceCode,
			}
		);
		if (response.ok) {
			const token = parseOAuthTokenResponse(response.json);
			if (!token.refreshToken) {
				throw new Error("xAI OAuth did not return a refresh token. Re-run sign-in.");
			}
			return {
				accessToken: token.accessToken,
				refreshToken: token.refreshToken,
				tokenEndpoint: discovery.tokenEndpoint,
				expiresAt: token.expiresAt,
				...(token.email ? { email: token.email } : {}),
				...(token.displayName ? { displayName: token.displayName } : {}),
			};
		}

		const error = readOAuthError(response.json);
		if (error === "authorization_pending" || error === "slow_down") {
			if (error === "slow_down") {
				intervalMs += SLOW_DOWN_INCREMENT_MS;
			}
			await delay(Math.min(Math.max(intervalMs, MIN_POLL_INTERVAL_MS), Math.max(0, deadline - Date.now())), options.signal);
			continue;
		}
		if (error === "access_denied" || error === "authorization_denied") {
			throw new Error("xAI OAuth authorization was denied.");
		}
		if (error === "expired_token") {
			throw new Error("xAI OAuth device code expired. Run sign-in again.");
		}
		throw new Error(formatOAuthFailure("xAI OAuth token exchange", response.status, response.json));
	}

	throw new Error("xAI OAuth device authorization timed out.");
}

export async function refreshXaiOAuthCredential(
	credential: XaiOAuthCredential,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: number } = {}
): Promise<XaiOAuthCredential> {
	const response = await requestJsonResponse(
		requireTrustedEndpoint(credential.tokenEndpoint, "token endpoint"),
		options,
		{
			grant_type: "refresh_token",
			client_id: XAI_OAUTH_CLIENT_ID,
			refresh_token: credential.refreshToken,
		}
	);
	if (!response.ok) {
		throw new Error(formatOAuthFailure("xAI OAuth refresh", response.status, response.json));
	}
	const token = parseOAuthTokenResponse(response.json);
	return {
		...credential,
		accessToken: token.accessToken,
		refreshToken: token.refreshToken ?? credential.refreshToken,
		expiresAt: token.expiresAt,
		...(token.email ? { email: token.email } : {}),
		...(token.displayName ? { displayName: token.displayName } : {}),
	};
}

async function requestJson(
	url: string,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
	body?: Record<string, string>
): Promise<Record<string, unknown>> {
	const response = await requestJsonResponse(url, options, body);
	if (!response.ok) {
		throw new Error(formatOAuthFailure("xAI OAuth request", response.status, response.json));
	}
	return response.json;
}

async function requestJsonResponse(
	url: string,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
	body?: Record<string, string>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error("xAI OAuth request timed out."));
	}, REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort(options.signal?.reason ?? new Error("xAI OAuth request cancelled."));
	options.signal?.addEventListener("abort", onAbort, { once: true });

	let response: Response;
	let text: string;
	try {
		response = await (options.fetchImpl ?? fetch)(url, {
			method: body ? "POST" : "GET",
			headers: {
				Accept: "application/json",
				...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
			},
			...(body ? { body: new URLSearchParams(body).toString() } : {}),
			signal: controller.signal,
		});
		text = await readResponseTextLimited(response);
	} catch (error) {
		if (timedOut) {
			throw new Error(`xAI OAuth request timed out after ${Math.ceil(REQUEST_TIMEOUT_MS / 1000)} seconds.`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
	let json: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			json = parsed as Record<string, unknown>;
		}
	} catch {
		// The status and generic failure are sufficient for malformed responses.
	}
	return { ok: response.ok, status: response.status, json };
}

async function readResponseTextLimited(response: Response): Promise<string> {
	if (!response.body) {
		return "";
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			totalBytes += value.byteLength;
			if (totalBytes > RESPONSE_MAX_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new Error(`xAI OAuth response exceeded the ${Math.floor(RESPONSE_MAX_BYTES / 1024)} KiB limit.`);
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} finally {
		reader.releaseLock();
	}
}

function parseOAuthTokenResponse(value: Record<string, unknown>): OAuthTokenResponse {
	const accessToken = requireString(value.access_token, "access_token");
	const refreshToken = typeof value.refresh_token === "string" ? value.refresh_token : undefined;
	const expiresIn = positiveMilliseconds(value.expires_in);
	const expiresAt = expiresIn !== undefined ? Date.now() + expiresIn : decodeJwtExpiry(accessToken) ?? Date.now() + 3_600_000;
	const identity = decodeJwtIdentity(typeof value.id_token === "string" ? value.id_token : accessToken);
	return {
		accessToken,
		...(refreshToken ? { refreshToken } : {}),
		expiresAt,
		...(identity.email ? { email: identity.email } : {}),
		...(identity.displayName ? { displayName: identity.displayName } : {}),
	};
}

function decodeJwtIdentity(token: string): { email?: string; displayName?: string } {
	try {
		const encoded = token.split(".")[1];
		if (!encoded) {
			return {};
		}
		const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
		return {
			...(typeof payload.email === "string" ? { email: payload.email } : {}),
			...(typeof payload.name === "string" ? { displayName: payload.name } : {}),
		};
	} catch {
		return {};
	}
}

function decodeJwtExpiry(token: string): number | undefined {
	try {
		const encoded = token.split(".")[1];
		if (!encoded) {
			return undefined;
		}
		const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
		return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

function positiveMilliseconds(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`xAI OAuth response is missing ${label}.`);
	}
	return value;
}

function requireTrustedEndpoint(value: unknown, label: string): string {
	const endpoint = requireString(value, label);
	if (!isTrustedXaiOAuthEndpoint(endpoint)) {
		throw new Error(`xAI OAuth returned an untrusted ${label}.`);
	}
	return endpoint;
}

function isTrustedXaiOAuthEndpoint(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		return url.protocol === "https:" && (url.hostname === "x.ai" || url.hostname.endsWith(".x.ai"));
	} catch {
		return false;
	}
}

function readOAuthError(value: Record<string, unknown>): string | undefined {
	return typeof value.error === "string" ? value.error : undefined;
}

function formatOAuthFailure(context: string, status: number, value: Record<string, unknown>): string {
	const error = readOAuthError(value);
	const description = typeof value.error_description === "string" ? value.error_description : undefined;
	return `${context} failed (${status})${error ? `: ${error}` : ""}${description ? ` (${description})` : ""}`;
}

async function delay(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		throw signal.reason instanceof Error ? signal.reason : new Error("xAI OAuth login cancelled.");
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		if (!signal) {
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason instanceof Error ? signal.reason : new Error("xAI OAuth login cancelled."));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

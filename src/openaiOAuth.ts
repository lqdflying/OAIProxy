/**
 * OpenAI ChatGPT/Codex device-code OAuth support.
 *
 * The device flow follows the contract used by OpenClaw's OpenAI provider,
 * while credentials remain private to OAIProxy's VS Code SecretStorage entry.
 */

import type { SecretStorageLike } from "./xaiOAuth";

export const OPENAI_OAUTH_SECRET_KEY = "oaicopilot.oauth.openai";
export const OPENAI_OAUTH_PROVIDER = "openai-oauth";
export const OPENAI_OAUTH_ISSUER = "https://auth.openai.com";
export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_VERIFICATION_URL = `${OPENAI_OAUTH_ISSUER}/codex/device`;
export const OPENAI_OAUTH_DEVICE_CODE_URL = `${OPENAI_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`;
export const OPENAI_OAUTH_DEVICE_TOKEN_URL = `${OPENAI_OAUTH_ISSUER}/api/accounts/deviceauth/token`;
export const OPENAI_OAUTH_TOKEN_URL = `${OPENAI_OAUTH_ISSUER}/oauth/token`;
export const OPENAI_OAUTH_DEVICE_CALLBACK_URL = `${OPENAI_OAUTH_ISSUER}/deviceauth/callback`;
export const OPENAI_CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_OAUTH_ORIGINATOR = "oaiproxy";
export const OPENAI_OAUTH_CLIENT_VERSION = "oaiproxy";

const DEVICE_CODE_TIMEOUT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const EXPIRY_SKEW_MS = 60_000;

export interface OpenAIOAuthCredential {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	email?: string;
	displayName?: string;
}

export interface OpenAIOAuthDeviceCodeInfo {
	userCode: string;
	verificationUri: string;
	expiresInMs: number;
}

export interface OpenAIOAuthLoginOptions {
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	onDeviceCode?: (info: OpenAIOAuthDeviceCodeInfo) => void | Promise<void>;
}

interface DeviceCodeResponse {
	deviceAuthId: string;
	userCode: string;
	intervalMs: number;
}

interface AuthorizationResponse {
	authorizationCode: string;
	codeVerifier: string;
}

interface OAuthTokenResponse {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	accountId?: string;
	email?: string;
	displayName?: string;
}

interface JsonResponse {
	ok: boolean;
	status: number;
	json: Record<string, unknown>;
}

let refreshPromise: Promise<OpenAIOAuthCredential> | undefined;

export function isOpenAICodexOAuthBaseUrl(baseUrl: string | undefined): boolean {
	if (!baseUrl) {
		return false;
	}
	try {
		const url = new URL(baseUrl);
		return (
			url.protocol === "https:" &&
			url.hostname.toLowerCase() === "chatgpt.com" &&
			/^\/backend-api\/codex(?:\/v1)?(?:\/)?$/u.test(url.pathname)
		);
	} catch {
		return false;
	}
}

/**
 * Returns true for the dedicated OAuth provider and the legacy OpenAI provider
 * used by pre-separation model settings.
 */
export function isOpenAICodexOAuthProvider(provider: string | undefined): boolean {
	const normalized = provider?.trim().toLowerCase();
	return normalized === OPENAI_OAUTH_PROVIDER || normalized === "openai";
}

export function applyOpenAICodexOAuthHeaders(
	headers: Record<string, string>,
	credential?: Pick<OpenAIOAuthCredential, "accountId">
): void {
	headers.originator = OPENAI_OAUTH_ORIGINATOR;
	headers.version = OPENAI_OAUTH_CLIENT_VERSION;
	headers["User-Agent"] = OPENAI_OAUTH_CLIENT_VERSION;
	if (credential?.accountId) {
		headers["ChatGPT-Account-Id"] = credential.accountId;
	}
}

export async function loadOpenAIOAuthCredential(
	secrets: SecretStorageLike
): Promise<OpenAIOAuthCredential | undefined> {
	const raw = await secrets.get(OPENAI_OAUTH_SECRET_KEY);
	if (!raw) {
		return undefined;
	}
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof value.accessToken !== "string" ||
			typeof value.refreshToken !== "string" ||
			typeof value.expiresAt !== "number"
		) {
			return undefined;
		}
		return {
			accessToken: value.accessToken,
			refreshToken: value.refreshToken,
			expiresAt: value.expiresAt,
			...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
			...(typeof value.email === "string" ? { email: value.email } : {}),
			...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
		};
	} catch {
		return undefined;
	}
}

export async function saveOpenAIOAuthCredential(
	secrets: SecretStorageLike,
	credential: OpenAIOAuthCredential
): Promise<void> {
	await secrets.store(OPENAI_OAUTH_SECRET_KEY, JSON.stringify(credential));
}

export async function clearOpenAIOAuthCredential(secrets: SecretStorageLike): Promise<void> {
	await secrets.delete(OPENAI_OAUTH_SECRET_KEY);
}

export async function getOpenAIOAuthAccessToken(
	secrets: SecretStorageLike,
	options: { now?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<string | undefined> {
	const credential = await loadOpenAIOAuthCredential(secrets);
	if (!credential) {
		return undefined;
	}
	const now = options.now ?? Date.now();
	if (credential.expiresAt > now + EXPIRY_SKEW_MS) {
		return credential.accessToken;
	}

	if (!refreshPromise) {
		refreshPromise = refreshOpenAIOAuthCredential(credential, options)
			.then(async (refreshed) => {
				await saveOpenAIOAuthCredential(secrets, refreshed);
				return refreshed;
			})
			.finally(() => {
				refreshPromise = undefined;
			});
	}
	return (await refreshPromise).accessToken;
}

export async function getOpenAIOAuthCredential(
	secrets: SecretStorageLike,
	options: { now?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<OpenAIOAuthCredential | undefined> {
	const credential = await loadOpenAIOAuthCredential(secrets);
	if (!credential) {
		return undefined;
	}
	const now = options.now ?? Date.now();
	if (credential.expiresAt > now + EXPIRY_SKEW_MS) {
		return credential;
	}
	if (!refreshPromise) {
		refreshPromise = refreshOpenAIOAuthCredential(credential, options)
			.then(async (refreshed) => {
				await saveOpenAIOAuthCredential(secrets, refreshed);
				return refreshed;
			})
			.finally(() => {
				refreshPromise = undefined;
			});
	}
	return await refreshPromise;
}

export async function loginOpenAIOAuth(options: OpenAIOAuthLoginOptions = {}): Promise<OpenAIOAuthCredential> {
	const device = await requestDeviceCode(options);
	await options.onDeviceCode?.({
		userCode: device.userCode,
		verificationUri: OPENAI_OAUTH_VERIFICATION_URL,
		expiresInMs: DEVICE_CODE_TIMEOUT_MS,
	});
	const authorization = await pollDeviceCode(device, options);
	return await exchangeDeviceCode(authorization, options);
}

export async function refreshOpenAIOAuthCredential(
	credential: OpenAIOAuthCredential,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: number } = {}
): Promise<OpenAIOAuthCredential> {
	const response = await requestForm(
		OPENAI_OAUTH_TOKEN_URL,
		{
			grant_type: "refresh_token",
			refresh_token: credential.refreshToken,
			client_id: OPENAI_OAUTH_CLIENT_ID,
		},
		options
	);
	if (!response.ok) {
		throw formatOAuthFailure("OpenAI OAuth refresh", response);
	}
	const token = parseTokenResponse(response.json, options.now);
	return {
		...credential,
		accessToken: token.accessToken,
		refreshToken: token.refreshToken ?? credential.refreshToken,
		expiresAt: token.expiresAt,
		...(token.accountId ? { accountId: token.accountId } : {}),
		...(token.email ? { email: token.email } : {}),
		...(token.displayName ? { displayName: token.displayName } : {}),
	};
}

async function requestDeviceCode(options: OpenAIOAuthLoginOptions): Promise<DeviceCodeResponse> {
	const response = await requestJson(
		OPENAI_OAUTH_DEVICE_CODE_URL,
		{
			client_id: OPENAI_OAUTH_CLIENT_ID,
		},
		options
	);
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error("OpenAI Codex device-code login is unavailable. Use the OpenAI API-key setup instead.");
		}
		throw formatOAuthFailure("OpenAI OAuth device-code request", response);
	}
	const deviceAuthId = requireString(response.json.device_auth_id, "device_auth_id");
	const userCode = requireString(response.json.user_code ?? response.json.usercode, "user_code");
	return {
		deviceAuthId,
		userCode,
		intervalMs: Math.max(
			MIN_POLL_INTERVAL_MS,
			positiveSeconds(response.json.interval) ?? DEFAULT_POLL_INTERVAL_MS
		),
	};
}

async function pollDeviceCode(
	device: DeviceCodeResponse,
	options: OpenAIOAuthLoginOptions
): Promise<AuthorizationResponse> {
	const deadline = Date.now() + DEVICE_CODE_TIMEOUT_MS;
	const intervalMs = device.intervalMs;
	while (Date.now() < deadline) {
		const response = await requestJson(
			OPENAI_OAUTH_DEVICE_TOKEN_URL,
			{
				device_auth_id: device.deviceAuthId,
				user_code: device.userCode,
			},
			options
		);
		if (response.ok) {
			return {
				authorizationCode: requireString(response.json.authorization_code, "authorization_code"),
				codeVerifier: requireString(response.json.code_verifier, "code_verifier"),
			};
		}
		if (response.status !== 403 && response.status !== 404) {
			throw formatOAuthFailure("OpenAI OAuth device authorization", response);
		}
		await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())), options.signal);
	}
	throw new Error("OpenAI OAuth device authorization timed out after 15 minutes.");
}

async function exchangeDeviceCode(
	authorization: AuthorizationResponse,
	options: OpenAIOAuthLoginOptions
): Promise<OpenAIOAuthCredential> {
	const response = await requestForm(
		OPENAI_OAUTH_TOKEN_URL,
		{
			grant_type: "authorization_code",
			code: authorization.authorizationCode,
			redirect_uri: OPENAI_OAUTH_DEVICE_CALLBACK_URL,
			client_id: OPENAI_OAUTH_CLIENT_ID,
			code_verifier: authorization.codeVerifier,
		},
		options
	);
	if (!response.ok) {
		throw formatOAuthFailure("OpenAI OAuth token exchange", response);
	}
	const token = parseTokenResponse(response.json);
	if (!token.refreshToken) {
		throw new Error("OpenAI OAuth token exchange did not return a refresh token. Run sign-in again.");
	}
	return {
		accessToken: token.accessToken,
		refreshToken: token.refreshToken,
		expiresAt: token.expiresAt,
		...(token.accountId ? { accountId: token.accountId } : {}),
		...(token.email ? { email: token.email } : {}),
		...(token.displayName ? { displayName: token.displayName } : {}),
	};
}

async function requestJson(
	url: string,
	body: Record<string, string>,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<JsonResponse> {
	return await request(
		url,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				originator: OPENAI_OAUTH_ORIGINATOR,
				version: OPENAI_OAUTH_CLIENT_VERSION,
				"User-Agent": OPENAI_OAUTH_CLIENT_VERSION,
			},
			body: JSON.stringify(body),
		},
		options
	);
}

async function requestForm(
	url: string,
	body: Record<string, string>,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<JsonResponse> {
	return await request(
		url,
		{
			method: "POST",
		headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
				originator: OPENAI_OAUTH_ORIGINATOR,
				version: OPENAI_OAUTH_CLIENT_VERSION,
				"User-Agent": OPENAI_OAUTH_CLIENT_VERSION,
			},
			body: new URLSearchParams(body).toString(),
		},
		options
	);
}

async function request(
	url: string,
	init: RequestInit,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch }
): Promise<JsonResponse> {
	if (!isTrustedOpenAIEndpoint(url)) {
		throw new Error("OpenAI OAuth returned an untrusted endpoint.");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error("OpenAI OAuth request timed out.")), REQUEST_TIMEOUT_MS);
	const onAbort = () => controller.abort(options.signal?.reason ?? new Error("OpenAI OAuth request cancelled."));
	options.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await (options.fetchImpl ?? fetch)(url, { ...init, signal: controller.signal });
		const text = (await response.text()).slice(0, 256 * 1024);
		let json: Record<string, unknown> = {};
		try {
			const parsed = JSON.parse(text);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				json = parsed as Record<string, unknown>;
			}
		} catch {
			// Status is enough for a sanitized failure message.
		}
		return { ok: response.ok, status: response.status, json };
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

function parseTokenResponse(value: Record<string, unknown>, now = Date.now()): OAuthTokenResponse {
	const accessToken = requireString(value.access_token, "access_token");
	const refreshToken = typeof value.refresh_token === "string" ? value.refresh_token : undefined;
	const expiresInMs = positiveSeconds(value.expires_in);
	const expiresAt = expiresInMs !== undefined
		? now + expiresInMs
		: decodeJwtExpiry(accessToken) ?? now + 3_600_000;
	const identity = decodeJwtIdentity(accessToken);
	return {
		accessToken,
		...(refreshToken ? { refreshToken } : {}),
		expiresAt,
		...(identity.accountId ? { accountId: identity.accountId } : {}),
		...(identity.email ? { email: identity.email } : {}),
		...(identity.displayName ? { displayName: identity.displayName } : {}),
	};
}

function decodeJwtIdentity(token: string): { accountId?: string; email?: string; displayName?: string } {
	try {
		const encoded = token.split(".")[1];
		if (!encoded) {
			return {};
		}
		const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
		const auth = payload["https://api.openai.com/auth"];
		const authObject = auth && typeof auth === "object" ? (auth as Record<string, unknown>) : undefined;
		return {
			...(typeof authObject?.chatgpt_account_id === "string" ? { accountId: authObject.chatgpt_account_id } : {}),
			...(typeof payload.chatgpt_account_id === "string" ? { accountId: payload.chatgpt_account_id } : {}),
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

function isTrustedOpenAIEndpoint(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && (url.hostname === "auth.openai.com" || url.hostname.endsWith(".auth.openai.com"));
	} catch {
		return false;
	}
}

function positiveSeconds(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`OpenAI OAuth response is missing ${label}.`);
	}
	return value;
}

function formatOAuthFailure(context: string, response: JsonResponse): Error {
	const error = typeof response.json.error === "string" ? response.json.error : undefined;
	const description = typeof response.json.error_description === "string" ? response.json.error_description : undefined;
	return new Error(`${context} failed (${response.status})${error ? `: ${error}` : ""}${description ? ` (${description})` : ""}`);
}

async function delay(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		throw signal.reason instanceof Error ? signal.reason : new Error("OpenAI OAuth login cancelled.");
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		if (!signal) {
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason instanceof Error ? signal.reason : new Error("OpenAI OAuth login cancelled."));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

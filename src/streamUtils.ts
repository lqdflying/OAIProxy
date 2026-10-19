/**
 * Shared helpers for provider streaming responses.
 */

/**
 * Extract a human-readable provider error message from a streamed payload.
 * Supports the common `{ error: { type, message } }`, `{ error: "..." }` and
 * Gemini `{ error: { code, message, status } }` shapes.
 */
export function extractProviderErrorMessage(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const error = (value as Record<string, unknown>).error;
	if (error === undefined || error === null || error === false || error === "") {
		return undefined;
	}
	if (typeof error === "string") {
		return error.trim() || undefined;
	}
	if (typeof error !== "object" || Array.isArray(error)) {
		return String(error);
	}
	const record = error as Record<string, unknown>;
	const message =
		typeof record.message === "string"
			? record.message
			: typeof record.Message === "string"
				? record.Message
				: undefined;
	const type =
		typeof record.type === "string"
			? record.type
			: typeof record.code === "string"
				? record.code
				: typeof record.status === "string"
					? record.status
					: typeof record.code === "number"
						? String(record.code)
						: undefined;
	if (message && type) {
		return `${type}: ${message}`;
	}
	if (message) {
		return message;
	}
	if (type) {
		return type;
	}
	try {
		return JSON.stringify(error).slice(0, 500);
	} catch {
		return undefined;
	}
}

/** Build a sanitized error raised after a provider error event in a stream. */
export function createProviderStreamError(providerLabel: string, message: string | undefined): Error {
	const detail = message?.trim() || "the provider reported an error";
	return new Error(`${providerLabel} streaming error: ${detail}`);
}

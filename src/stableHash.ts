import { createHash } from "crypto";

/**
 * Deterministic JSON serialization: object keys are sorted so semantically
 * identical values produce identical strings across turns and processes.
 */
export function stableStringify(value: unknown): string {
	if (value === null || value === undefined) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return `{${Object.keys(obj)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** SHA-256 hex digest of {@link stableStringify}. */
export function hashStableValue(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

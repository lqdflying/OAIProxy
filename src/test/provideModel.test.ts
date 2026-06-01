import * as assert from "assert";
import {
	normalizeModelPickerContextLength,
	resolveModelTokenLimits,
} from "../modelTokenLimits";

suite("provideModel", () => {
	test("normalizes one mebibyte context to one decimal million for picker display", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 1048576,
			max_tokens: 65536,
		});

		assert.strictEqual(normalizeModelPickerContextLength(1048576), 1000000);
		assert.strictEqual(tokenLimits.contextLength, 1048576);
		assert.strictEqual(tokenLimits.advertisedContextLength, 1000000);
		assert.strictEqual(tokenLimits.maxInputTokens, 934464);
		assert.strictEqual(tokenLimits.maxOutputTokens, 65536);
	});

	test("normalizes near-million provider context values", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 1050000,
			max_tokens: 128000,
		});

		assert.strictEqual(tokenLimits.advertisedContextLength, 1000000);
		assert.strictEqual(tokenLimits.maxInputTokens + tokenLimits.maxOutputTokens, 1000000);
	});

	test("preserves non-near-million context values", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 1500000,
			max_tokens: 65536,
		});

		assert.strictEqual(tokenLimits.advertisedContextLength, 1500000);
		assert.strictEqual(tokenLimits.maxInputTokens + tokenLimits.maxOutputTokens, 1500000);
	});
});

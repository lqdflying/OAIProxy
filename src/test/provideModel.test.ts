import * as assert from "assert";
import {
	normalizeModelPickerContextLength,
	resolveModelTokenLimits,
} from "../modelTokenLimits";
import { MODEL_PICKER_METADATA } from "../modelPickerMetadata";

suite("provideModel", () => {
	test("uses VS Code 1.126-compatible BYOK picker metadata", () => {
		assert.deepStrictEqual(MODEL_PICKER_METADATA, {
			isUserSelectable: true,
			isBYOK: true,
		});
		assert.strictEqual("category" in MODEL_PICKER_METADATA, false);
	});

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

	test("honors conservative max input token budget", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 262144,
			max_input_tokens: 180000,
			max_completion_tokens: 32768,
		});

		assert.strictEqual(tokenLimits.contextLength, 262144);
		assert.strictEqual(tokenLimits.advertisedContextLength, 262144);
		assert.strictEqual(tokenLimits.maxInputTokens, 180000);
		assert.strictEqual(tokenLimits.maxOutputTokens, 32768);
	});

	test("caps max input token budget at context minus output reserve", () => {
		const tokenLimits = resolveModelTokenLimits({
			context_length: 262144,
			max_input_tokens: 999999,
			max_completion_tokens: 32768,
		});

		assert.strictEqual(tokenLimits.maxInputTokens, 229376);
		assert.strictEqual(tokenLimits.maxOutputTokens, 32768);
	});
});

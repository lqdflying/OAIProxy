import * as assert from "assert";
import { COPILOT_USAGE_MIME, isResponseUsagePart, ResponseUsageAccumulator } from "../responseUsage";

suite("responseUsage", () => {
	test("normalizes OpenAI usage without cache metadata", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({
			usage: {
				prompt_tokens: 120,
				completion_tokens: 15,
				total_tokens: 135,
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 120,
			completion_tokens: 15,
			total_tokens: 135,
			prompt_tokens_details: { cached_tokens: 0 },
		});
	});

	test("preserves OpenAI cache and reasoning details", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({
			usage: {
				prompt_tokens: 1000,
				completion_tokens: 80,
				total_tokens: 1080,
				prompt_tokens_details: { cached_tokens: 750 },
				completion_tokens_details: { reasoning_tokens: 60 },
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 1000,
			completion_tokens: 80,
			total_tokens: 1080,
			prompt_tokens_details: { cached_tokens: 750 },
			completion_tokens_details: { reasoning_tokens: 60 },
		});
	});

	test("normalizes nested OpenAI Responses usage", () => {
		const accumulator = new ResponseUsageAccumulator("openai-responses");
		accumulator.record({
			response: {
				usage: {
					input_tokens: 700,
					output_tokens: 50,
					total_tokens: 750,
					input_tokens_details: { cached_tokens: 500 },
					output_tokens_details: { reasoning_tokens: 30 },
				},
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 700,
			completion_tokens: 50,
			total_tokens: 750,
			prompt_tokens_details: { cached_tokens: 500 },
			completion_tokens_details: { reasoning_tokens: 30 },
		});
	});

	test("merges Anthropic start and delta usage including cached input", () => {
		const accumulator = new ResponseUsageAccumulator("anthropic");
		accumulator.record({
			type: "message_start",
			message: {
				usage: {
					input_tokens: 50,
					output_tokens: 1,
					cache_read_input_tokens: 100000,
					cache_creation_input_tokens: 20,
				},
			},
		});
		accumulator.record({
			type: "message_delta",
			usage: {
				output_tokens: 75,
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 100070,
			completion_tokens: 75,
			total_tokens: 100145,
			prompt_tokens_details: { cached_tokens: 100000 },
			cache_creation_input_tokens: 20,
		});
	});

	test("normalizes Gemini usage metadata", () => {
		const accumulator = new ResponseUsageAccumulator("gemini");
		accumulator.record({
			usageMetadata: {
				promptTokenCount: 410,
				candidatesTokenCount: 22,
				totalTokenCount: 432,
				cachedContentTokenCount: 300,
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 410,
			completion_tokens: 22,
			total_tokens: 432,
			prompt_tokens_details: { cached_tokens: 300 },
		});
	});

	test("includes repeated Gemini thought counts in completion usage without double counting", () => {
		const accumulator = new ResponseUsageAccumulator("gemini");
		const metadata = {
			promptTokenCount: 1000,
			candidatesTokenCount: 50,
			thoughtsTokenCount: 500,
			totalTokenCount: 1550,
		};
		accumulator.record({ usageMetadata: metadata });
		accumulator.record({ usageMetadata: metadata });

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 1000,
			completion_tokens: 550,
			total_tokens: 1550,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 500 },
		});
	});

	test("uses DeepSeek prompt cache hit counts when the generic cache field is zero", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({
			usage: {
				prompt_tokens: 1000,
				completion_tokens: 25,
				total_tokens: 1025,
				prompt_tokens_details: { cached_tokens: 0 },
				prompt_cache_hit_tokens: 800,
				prompt_cache_miss_tokens: 200,
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 1000,
			completion_tokens: 25,
			total_tokens: 1025,
			prompt_tokens_details: { cached_tokens: 800 },
		});
	});

	test("derives DeepSeek cached tokens from the miss count when no hit field is present", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({
			usage: {
				prompt_tokens: 1000,
				completion_tokens: 25,
				total_tokens: 1025,
				prompt_cache_miss_tokens: 250,
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 1000,
			completion_tokens: 25,
			total_tokens: 1025,
			prompt_tokens_details: { cached_tokens: 750 },
		});
	});

	test("normalizes Ollama final counters and computes total", () => {
		const accumulator = new ResponseUsageAccumulator("ollama");
		accumulator.record({ prompt_eval_count: 90, eval_count: 10 });

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 90,
			completion_tokens: 10,
			total_tokens: 100,
			prompt_tokens_details: { cached_tokens: 0 },
		});
	});

	test("ignores invalid later counts without erasing valid usage", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({ usage: { prompt_tokens: 40.9, completion_tokens: 5.8 } });
		accumulator.record({
			usage: {
				prompt_tokens: -1,
				completion_tokens: Number.POSITIVE_INFINITY,
				total_tokens: Number.NaN,
			},
		});

		assert.deepStrictEqual(accumulator.toUsage(), {
			prompt_tokens: 40,
			completion_tokens: 5,
			total_tokens: 45,
			prompt_tokens_details: { cached_tokens: 0 },
		});
	});

	test("does not create a part without authoritative prompt usage", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({ usage: { completion_tokens: 12 } });

		assert.strictEqual(accumulator.toUsage(), null);
		assert.strictEqual(accumulator.toDataPart(), null);
	});

	test("encodes normalized usage in the Copilot usage data part", () => {
		const accumulator = new ResponseUsageAccumulator("openai");
		accumulator.record({ usage: { prompt_tokens: 25, completion_tokens: 4 } });

		const part = accumulator.toDataPart();
		assert.ok(part);
		assert.strictEqual(part.mimeType, COPILOT_USAGE_MIME);
		assert.ok(isResponseUsagePart(part));
		assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(part.data)), {
			prompt_tokens: 25,
			completion_tokens: 4,
			total_tokens: 29,
			prompt_tokens_details: { cached_tokens: 0 },
		});
	});
});

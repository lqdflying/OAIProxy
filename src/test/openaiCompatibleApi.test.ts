import * as assert from "assert";
import * as vscode from "vscode";

import { MODEL_PRESETS } from "../modelPresets";
import { OpenaiCompatibleApi, shouldPruneOpenAICompatibleSampling } from "../openai/openaiCompatibleApi";
import type { HFModelItem } from "../types";

const BASE_URL = "https://gateway.example.com/v1";

function model(overrides: Partial<HFModelItem> = {}): HFModelItem {
	return {
		id: "gpt-6-astra",
		owned_by: "openai-compatible",
		baseUrl: BASE_URL,
		apiMode: "openai-compatible",
		context_length: 258000,
		max_tokens: 128000,
		prompt_cache: { enabled: true },
		...overrides,
	};
}

function prepare(
	modelItem: HFModelItem,
	options?: vscode.ProvideLanguageModelChatResponseOptions,
	messages: Record<string, unknown>[] = [
		{ role: "system", content: "You are a coding agent." },
		{ role: "user", content: "Explain the failing test." },
	]
): Record<string, unknown> {
	const api = new OpenaiCompatibleApi(modelItem.id);
	return api.prepareRequestBody(
		{
			model: modelItem.id,
			messages,
			stream: true,
			stream_options: { include_usage: true },
		},
		modelItem,
		options
	);
}

suite("openaiCompatibleApi", () => {
	test("prunes sampling controls for GPT-6 Astra and GPT-6.1 Sol only", () => {
		for (const modelId of ["gpt-6-astra", "gpt-6-astra-2026-09-03", "gpt-6.1-sol", "gpt-6.1-sol-2026-09-29"]) {
			assert.strictEqual(shouldPruneOpenAICompatibleSampling(modelId), true, modelId);
		}
		for (const modelId of ["gpt-5.5", "gpt-5.6-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.5-pro"]) {
			assert.strictEqual(shouldPruneOpenAICompatibleSampling(modelId), false, modelId);
		}

		const sampling = { temperature: 0.3, top_p: 0.9, frequency_penalty: 0.1, presence_penalty: 0.2 };
		const astra = prepare(model({ id: "gpt-6-astra", ...sampling }));
		assert.strictEqual(astra.temperature, undefined);
		assert.strictEqual(astra.top_p, undefined);
		assert.strictEqual(astra.frequency_penalty, undefined);
		assert.strictEqual(astra.presence_penalty, undefined);

		const sol = prepare(model({ id: "gpt-6.1-sol", ...sampling }));
		assert.strictEqual(sol.temperature, undefined);
		assert.strictEqual(sol.top_p, undefined);

		const gpt55 = prepare(model({ id: "gpt-5.5", ...sampling }));
		assert.strictEqual(gpt55.temperature, 0.3);
		assert.strictEqual(gpt55.top_p, 0.9);
		assert.strictEqual(gpt55.frequency_penalty, 0.1);
		assert.strictEqual(gpt55.presence_penalty, 0.2);
	});

	test("sends max_tokens and top-level reasoning_effort only", () => {
		const body = prepare(
			model({
				max_tokens: undefined,
				max_completion_tokens: 4096,
				reasoning_effort: "xhigh",
				reasoning: { effort: "high", exclude: false },
				thinking: { type: "enabled" },
				enable_thinking: true,
				thinking_budget: 1024,
				top_k: 20,
				min_p: 0.05,
				repetition_penalty: 1.1,
			})
		);

		assert.strictEqual(body.max_tokens, 4096);
		assert.strictEqual(body.max_completion_tokens, undefined);
		assert.strictEqual(body.reasoning_effort, "xhigh");
		assert.strictEqual(body.reasoning, undefined);
		assert.strictEqual(body.thinking, undefined);
		assert.strictEqual(body.enable_thinking, undefined);
		assert.strictEqual(body.thinking_budget, undefined);
		assert.strictEqual(body.top_k, undefined);
		assert.strictEqual(body.min_p, undefined);
		assert.strictEqual(body.repetition_penalty, undefined);
		assert.deepStrictEqual(body.stream_options, { include_usage: true });
	});

	test("resolves nested reasoning effort without forwarding the reasoning object", () => {
		const body = prepare(model({ id: "gpt-6-astra", reasoning: { effort: "high" } }));
		assert.strictEqual(body.reasoning_effort, "high");
		assert.strictEqual(body.reasoning, undefined);

		const topLevelWins = prepare(
			model({ id: "gpt-6-astra", reasoning: { effort: "high" }, reasoning_effort: "max" })
		);
		assert.strictEqual(topLevelWins.reasoning_effort, "max");
		assert.strictEqual(topLevelWins.reasoning, undefined);
	});

	test("forwards an explicit cache retention window only with a cache key", () => {
		const retention = prepare(model({ prompt_cache: { enabled: true, retention: "24h" } }));
		assert.strictEqual(typeof retention.prompt_cache_key, "string");
		assert.strictEqual(retention.prompt_cache_retention, "24h");

		const retentionOnly = prepare(model({ prompt_cache: { retention: "in_memory" } }));
		assert.strictEqual(typeof retentionOnly.prompt_cache_key, "string");
		assert.strictEqual(retentionOnly.prompt_cache_retention, "in_memory");

		const disabled = prepare(model({ prompt_cache: { enabled: false, retention: "24h" } }));
		assert.strictEqual(disabled.prompt_cache_key, undefined);
		assert.strictEqual(disabled.prompt_cache_retention, undefined);
	});

	test("keeps extra as the escape hatch, merging extra tools", () => {
		const tools = [{ type: "function", function: { name: "echo", parameters: { type: "object" } } }];
		const body = prepare(model({ extra: { tools, response_format: { type: "json_object" } } }));

		assert.deepStrictEqual(body.tools, tools);
		assert.deepStrictEqual(body.response_format, { type: "json_object" });
	});

	test("forwards stop and required tool selection", () => {
		const body = prepare(model(), {
			requestInitiator: "test",
			toolMode: vscode.LanguageModelChatToolMode.Required,
			modelOptions: { stop: ["END"] },
			tools: [{ name: "echo", description: "Echo a value", inputSchema: { type: "object" } }],
		} as unknown as vscode.ProvideLanguageModelChatResponseOptions);

		assert.deepStrictEqual(body.stop, ["END"]);
		assert.deepStrictEqual(body.tools, [
			{ type: "function", function: { name: "echo", description: "Echo a value", parameters: { type: "object" } } },
		]);
		assert.deepStrictEqual(body.tool_choice, { type: "function", function: { name: "echo" } });
	});

	test("derives a conversation-stable prompt cache key", () => {
		const first = prepare(model({ id: "gpt-5.5", reasoning_effort: "max" }));
		const second = prepare(model({ id: "gpt-5.5", reasoning_effort: "max" }), undefined, [
			{ role: "system", content: "You are a coding agent." },
			{ role: "user", content: "Explain the failing test." },
			{ role: "assistant", content: "The assertion is stale." },
			{ role: "user", content: "Fix it." },
		]);

		assert.strictEqual(typeof first.prompt_cache_key, "string");
		assert.ok((first.prompt_cache_key as string).startsWith("oaiproxy-cc-"));
		assert.strictEqual(first.prompt_cache_key, second.prompt_cache_key);

		const otherModel = prepare(model({ id: "gpt-6-astra", reasoning_effort: "max" }));
		const otherEffort = prepare(model({ id: "gpt-5.5", reasoning_effort: "xhigh" }));
		assert.notStrictEqual(first.prompt_cache_key, otherModel.prompt_cache_key);
		assert.notStrictEqual(first.prompt_cache_key, otherEffort.prompt_cache_key);
	});

	test("honours explicit and disabled prompt cache configuration", () => {
		const explicit = prepare(model({ prompt_cache: { enabled: true, key: "team-conversation" } }));
		assert.strictEqual(explicit.prompt_cache_key, "team-conversation");

		const disabled = prepare(model({ prompt_cache: { enabled: false, key: "team-conversation" } }));
		assert.strictEqual(disabled.prompt_cache_key, undefined);

		const unset = prepare(model({ prompt_cache: undefined }));
		assert.strictEqual(unset.prompt_cache_key, undefined);

		const fromExtra = prepare(model({ extra: { prompt_cache_key: "extra-key" } }));
		assert.strictEqual(fromExtra.prompt_cache_key, "extra-key");
	});

	test("ships a single OpenAI Compatible Quick Setup card", () => {
		const presets = MODEL_PRESETS.filter((preset) => preset.model.owned_by === "openai-compatible");
		assert.deepStrictEqual(presets.map((preset) => preset.id), ["openai-compatible-gpt-6-astra"]);

		for (const preset of presets) {
			const body = prepare(preset.model);
			assert.strictEqual(body.model, preset.model.id);
			assert.strictEqual(body.apiMode, undefined);
			assert.strictEqual(body.max_tokens, 128000);
			assert.strictEqual(body.max_completion_tokens, undefined);
			assert.strictEqual(body.reasoning_effort, preset.model.default_reasoning_effort);
			assert.strictEqual(typeof body.prompt_cache_key, "string");
			assert.deepStrictEqual(body.stream_options, { include_usage: true });
		}
	});
});

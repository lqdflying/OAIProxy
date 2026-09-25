import * as assert from "assert";
import { readFileSync } from "fs";
import * as path from "path";
import { parseConfigFileTextToJson } from "typescript";
import { MODEL_PRESETS } from "../modelPresets";
import { PROVIDER_PRESETS } from "../providerPresets";

suite("modelPresets", () => {
	test("contains the verified OpenAI Codex OAuth cards", () => {
		const expectedModels = ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
		assert.deepStrictEqual(
			MODEL_PRESETS.filter((preset) => preset.model.authMode === "oauth" && preset.model.owned_by === "openai-oauth").map(
				(preset) => preset.model.id
			),
			expectedModels
		);
		for (const modelId of expectedModels) {
			const preset = MODEL_PRESETS.find((item) => item.model.id === modelId && item.model.authMode === "oauth");
			assert.ok(preset);
			assert.strictEqual(preset.providerPresetId, "openai-oauth");
			assert.strictEqual(preset.model.configId, "openai-oauth");
			assert.strictEqual(preset.model.baseUrl, "https://chatgpt.com/backend-api/codex");
			assert.strictEqual(preset.model.apiMode, "openai-responses");
			assert.strictEqual(preset.model.context_length, 1050000);
			assert.strictEqual(preset.model.max_tokens, 128000);
			assert.strictEqual(preset.model.max_completion_tokens, undefined);
			assert.strictEqual(preset.model.vision, true);
			assert.strictEqual(preset.model.toolCalling, true);
			assert.ok(preset.model._comment?.includes("https://developers.openai.com/api/docs/models"));
		}
	});

	test("contains Grok 4.7 and 4.6 OAuth quick setup cards", () => {
		for (const expected of [
			{ id: "xai-grok-4-7-oauth", modelId: "grok-4.7", category: "latest" },
			{ id: "xai-grok-4-6-oauth", modelId: "grok-4.6", category: "recommended" },
		]) {
			const preset = MODEL_PRESETS.find((item) => item.id === expected.id);
			assert.ok(preset);
			assert.strictEqual(preset.providerPresetId, "xai-oauth");
			assert.strictEqual(preset.category, expected.category);
			assert.strictEqual(preset.model.id, expected.modelId);
			assert.strictEqual(preset.model.configId, "xai-oauth");
			assert.strictEqual(preset.model.owned_by, "xai");
			assert.strictEqual(preset.model.authMode, "oauth");
			assert.strictEqual(preset.model.baseUrl, "https://cli-chat-proxy.grok.com/v1");
			assert.strictEqual(preset.model.apiMode, "openai-responses");
			assert.strictEqual(preset.model.context_length, 500000);
			assert.strictEqual(preset.model.max_tokens, 64000);
			assert.strictEqual(preset.model.max_completion_tokens, undefined);
			assert.strictEqual(preset.model.vision, true);
			assert.strictEqual(preset.model.toolCalling, true);
			assert.deepStrictEqual(preset.model.supported_reasoning_efforts, ["low", "medium", "high", "xhigh"]);
			assert.strictEqual(preset.model.default_reasoning_effort, "high");
			assert.ok(preset.model._comment?.includes("https://docs.x.ai/developers/rest-api-reference/inference"));
		}
	});
	test("every preset has provider, API mode, base URL, context, and exactly one output token field", () => {
		for (const preset of MODEL_PRESETS) {
			const model = preset.model;
			assert.ok(model.id, `${preset.id} is missing model id`);
			assert.ok(model.owned_by, `${preset.id} is missing provider`);
			assert.ok(model.apiMode, `${preset.id} is missing apiMode`);
			assert.ok(model.baseUrl, `${preset.id} is missing baseUrl`);
			assert.ok(model.context_length && model.context_length > 0, `${preset.id} is missing context_length`);

			const hasMaxTokens = model.max_tokens !== undefined;
			const hasMaxCompletionTokens = model.max_completion_tokens !== undefined;
			assert.notStrictEqual(
				hasMaxTokens,
				hasMaxCompletionTokens,
				`${preset.id} must define exactly one output token field`
			);
		}
	});

	test("references existing provider presets", () => {
		const providerPresetIds = new Set(PROVIDER_PRESETS.map((preset) => preset.id));
		for (const preset of MODEL_PRESETS) {
			assert.ok(providerPresetIds.has(preset.providerPresetId), `${preset.id} references missing provider preset`);
		}
	});

	test("every preset saves an official source note into generated model JSON", () => {
		for (const preset of MODEL_PRESETS) {
			assert.ok(preset.model._comment, `${preset.id} is missing _comment source note`);
			assert.ok(preset.model._comment.includes("https://"), `${preset.id} _comment should include a source URL`);
		}
	});

	test("sets max reasoning as the direct DeepSeek Quick Setup default", () => {
		for (const presetId of ["deepseek-v4-pro", "deepseek-flash"]) {
			const preset = MODEL_PRESETS.find((item) => item.id === presetId);

			assert.ok(preset);
			assert.strictEqual(preset.model.reasoning_effort, "max");
			assert.deepStrictEqual(
				preset.model.supported_reasoning_efforts,
				presetId === "deepseek-flash" ? ["low", "high", "max"] : ["high", "max"]
			);
			assert.strictEqual(preset.model.default_reasoning_effort, "max");
		}
	});

	test("replaces legacy direct Flash cards with the vision-capable DeepSeek Flash preset", () => {
		const directPresets = MODEL_PRESETS.filter((preset) => preset.providerPresetId === "deepseek");
		assert.deepStrictEqual(
			directPresets.map((preset) => preset.id),
			["deepseek-v4-pro", "deepseek-flash"]
		);
		assert.deepStrictEqual(
			directPresets.map((preset) => preset.model.id),
			["deepseek-v4-pro", "deepseek-flash"]
		);

		const preset = directPresets.find((item) => item.id === "deepseek-flash");
		assert.ok(preset);
		assert.strictEqual(preset.label, "DeepSeek Flash");
		assert.strictEqual(preset.category, "fast");
		assert.deepStrictEqual(preset.tags, ["DeepSeek", "Fast", "Vision", "Reasoning", "Tools"]);
		assert.strictEqual(preset.model.displayName, "DeepSeek Flash");
		assert.strictEqual(preset.model.owned_by, "deepseek");
		assert.strictEqual(preset.model.baseUrl, "https://api.deepseek.com");
		assert.strictEqual(preset.model.apiMode, "openai");
		assert.strictEqual(preset.model.context_length, 1048576);
		assert.strictEqual(preset.model.max_tokens, 393216);
		assert.strictEqual(preset.model.max_completion_tokens, undefined);
		assert.strictEqual(preset.model.vision, true);
		assert.strictEqual(preset.model.toolCalling, true);
		assert.strictEqual(preset.model.include_reasoning_in_request, true);
		assert.deepStrictEqual(preset.model.thinking, { type: "enabled" });
		assert.strictEqual(preset.model.prompt_cache, undefined);
		assert.ok(preset.model._comment?.includes("https://api-docs.deepseek.com/api/create-chat-completion"));
		assert.ok(preset.model._comment?.includes("https://api-docs.deepseek.com/guides/vision"));
	});

	test("contains the two direct Azure Foundry presets with verified defaults", () => {
		const presets = MODEL_PRESETS.filter((preset) => preset.providerPresetId === "azure-foundry");
		assert.deepStrictEqual(
			presets.map((preset) => preset.id),
			["azure-foundry-kimi-k2-6", "azure-foundry-deepseek-v4-pro"]
		);

		const kimi = presets[0].model;
		assert.strictEqual(kimi.id, "Kimi-K2.6");
		assert.strictEqual(kimi.configId, "azure-foundry");
		assert.strictEqual(kimi.owned_by, "azure-foundry");
		assert.strictEqual(kimi.apiMode, "azure-foundry");
		assert.strictEqual(kimi.context_length, 262144);
		assert.strictEqual(kimi.max_completion_tokens, 32768);
		assert.strictEqual(kimi.max_tokens, undefined);
		assert.strictEqual(kimi.vision, true);
		assert.strictEqual(kimi.reasoning_effort, "high");
		assert.deepStrictEqual(kimi.supported_reasoning_efforts, ["none", "minimal", "low", "medium", "high"]);
		assert.strictEqual(kimi.default_reasoning_effort, "high");
		assert.strictEqual(kimi.toolCalling, true);
		assert.strictEqual(kimi.include_reasoning_in_request, true);
		assert.strictEqual(kimi.thinking, undefined);
		assert.strictEqual(kimi.prompt_cache, undefined);

		const deepseek = presets[1].model;
		assert.strictEqual(deepseek.id, "DeepSeek-V4-Pro");
		assert.strictEqual(deepseek.configId, "azure-foundry");
		assert.strictEqual(deepseek.owned_by, "azure-foundry");
		assert.strictEqual(deepseek.apiMode, "azure-foundry");
		assert.strictEqual(deepseek.context_length, 1000000);
		assert.strictEqual(deepseek.max_tokens, 128000);
		assert.strictEqual(deepseek.max_completion_tokens, undefined);
		assert.strictEqual(deepseek.vision, false);
		assert.strictEqual(deepseek.reasoning_effort, "max");
		assert.deepStrictEqual(deepseek.supported_reasoning_efforts, ["none", "high", "max"]);
		assert.strictEqual(deepseek.default_reasoning_effort, "max");
		assert.strictEqual(deepseek.toolCalling, true);
		assert.strictEqual(deepseek.include_reasoning_in_request, true);
		assert.strictEqual(deepseek.thinking, undefined);
		assert.strictEqual(deepseek.prompt_cache, undefined);
	});

	test("contains the approved MiMo chat presets", () => {
		const mimoIds = MODEL_PRESETS.filter((preset) => preset.model.owned_by === "mimo").map((preset) => preset.model.id);
		assert.deepStrictEqual(mimoIds, [
			"mimo-v2.6-pro",
			"mimo-v2.6-flash",
			"mimo-v2.5-pro",
			"mimo-v2.5",
			"mimo-v2-flash",
		]);

		for (const expected of [
			{
				presetId: "mimo-v2-6-pro",
				label: "MiMo V2.6 Pro",
				category: "latest",
				tags: ["MiMo", "Vision", "Thinking", "Tools"],
				modelId: "mimo-v2.6-pro",
			},
			{
				presetId: "mimo-v2-6-flash",
				label: "MiMo V2.6 Flash",
				category: "fast",
				tags: ["MiMo", "Fast", "Vision", "Thinking", "Tools"],
				modelId: "mimo-v2.6-flash",
			},
		] as const) {
			const preset = MODEL_PRESETS.find((item) => item.id === expected.presetId);

			assert.ok(preset);
			assert.strictEqual(preset.label, expected.label);
			assert.strictEqual(preset.providerPresetId, "mimo");
			assert.strictEqual(preset.category, expected.category);
			assert.deepStrictEqual(preset.tags, expected.tags);
			assert.strictEqual(preset.model.id, expected.modelId);
			assert.ok(preset.model._comment?.includes("https://mimo.mi.com/docs/en-US/quick-start/summary/model"));
			assert.ok(preset.model._comment?.includes("https://mimo.mi.com/docs/en-US/api/chat/openai-api"));
			assert.strictEqual(preset.model.displayName, expected.label);
			assert.strictEqual(preset.model.owned_by, "mimo");
			assert.strictEqual(preset.model.baseUrl, "https://api.xiaomimimo.com/v1");
			assert.strictEqual(preset.model.apiMode, "openai");
			assert.strictEqual(preset.model.context_length, 1048576);
			assert.strictEqual(preset.model.max_completion_tokens, 131072);
			assert.strictEqual(preset.model.max_tokens, undefined);
			assert.strictEqual(preset.model.vision, true);
			assert.strictEqual(preset.model.toolCalling, true);
			assert.strictEqual(preset.model.include_reasoning_in_request, true);
			assert.deepStrictEqual(preset.model.thinking, { type: "enabled" });
		}
	});

	test("contains Kimi K3 quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "kimi-k3");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Kimi K3");
		assert.strictEqual(preset.providerPresetId, "kimi");
		assert.strictEqual(preset.category, "latest");
		assert.deepStrictEqual(preset.tags, ["Kimi", "Code", "Vision", "Thinking", "Tools", "Prompt Cache"]);
		assert.strictEqual(preset.model.id, "kimi-k3");
		assert.ok(preset.model._comment?.includes("https://platform.kimi.ai/docs/guide/kimi-k3-quickstart"));
		assert.strictEqual(preset.model.displayName, "Kimi K3");
		assert.strictEqual(preset.model.owned_by, "kimi");
		assert.strictEqual(preset.model.baseUrl, "https://api.moonshot.ai/v1");
		assert.strictEqual(preset.model.apiMode, "openai");
		assert.strictEqual(preset.model.context_length, 1048576);
		assert.strictEqual(preset.model.max_completion_tokens, 131072);
		assert.strictEqual(preset.model.max_tokens, undefined);
		assert.strictEqual(preset.model.reasoning_effort, "max");
		assert.deepStrictEqual(preset.model.supported_reasoning_efforts, ["max"]);
		assert.strictEqual(preset.model.default_reasoning_effort, "max");
		assert.strictEqual(preset.model.vision, true);
		assert.strictEqual(preset.model.toolCalling, true);
		assert.strictEqual(preset.model.include_reasoning_in_request, true);
		assert.strictEqual(preset.model.thinking, undefined);
		assert.strictEqual(preset.model.temperature, undefined);
		assert.strictEqual(preset.model.top_p, undefined);
		assert.strictEqual(preset.model.prompt_cache, undefined);
	});

	test("contains Kimi K2.7 Code quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "kimi-k2-7-code");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Kimi K2.7 Code");
		assert.strictEqual(preset.providerPresetId, "kimi");
		assert.strictEqual(preset.category, "latest");
		assert.strictEqual(preset.model.id, "kimi-k2.7-code");
		assert.ok(preset.model._comment?.includes("https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart"));
		assert.strictEqual(preset.model.displayName, "Kimi K2.7 Code");
		assert.strictEqual(preset.model.owned_by, "kimi");
		assert.strictEqual(preset.model.baseUrl, "https://api.moonshot.ai/v1");
		assert.strictEqual(preset.model.apiMode, "openai");
		assert.strictEqual(preset.model.context_length, 262144);
		assert.strictEqual(preset.model.max_input_tokens, 180000);
		assert.strictEqual(preset.model.max_completion_tokens, 32768);
		assert.strictEqual(preset.model.max_tokens, undefined);
		assert.strictEqual(preset.model.vision, true);
		assert.strictEqual(preset.model.toolCalling, true);
		assert.strictEqual(preset.model.include_reasoning_in_request, true);
		assert.strictEqual(preset.model.thinking, undefined);
		assert.strictEqual(preset.model.temperature, undefined);
		assert.strictEqual(preset.model.top_p, undefined);
	});

	test("contains the four TokenRouter Quick Setup cards", () => {
		const expected = [
			{
				presetId: "tokenrouter-deepseek-v4-pro-0813",
				modelId: "deepseek/deepseek-v4-pro-0813",
				label: "DeepSeek V4 Pro 0813 (TokenRouter)",
				contextLength: 1048576,
				maxTokens: 393216,
				maxCompletionTokens: undefined,
				vision: false,
				effort: ["low", "high", "max"],
				defaultEffort: "max",
			},
			{
				presetId: "tokenrouter-qwen-3-8-max",
				modelId: "qwen/qwen3.8-max",
				label: "Qwen3.8-Max (TokenRouter)",
				contextLength: 1000000,
				maxTokens: undefined,
				maxCompletionTokens: 65536,
				vision: true,
				effort: ["low", "medium", "xhigh"],
				defaultEffort: "xhigh",
			},
			{
				presetId: "tokenrouter-kimi-k3",
				modelId: "moonshotai/kimi-k3",
				label: "Kimi K3 (TokenRouter)",
				contextLength: 1048576,
				maxTokens: undefined,
				maxCompletionTokens: 131072,
				vision: true,
				effort: ["low", "high", "max"],
				defaultEffort: "max",
			},
			{
				presetId: "tokenrouter-glm-5-3",
				modelId: "z-ai/glm-5.3",
				label: "GLM-5.3 (TokenRouter)",
				contextLength: 1000000,
				maxTokens: 131072,
				maxCompletionTokens: undefined,
				vision: false,
				effort: ["low", "high", "max"],
				defaultEffort: "max",
			},
		];

		for (const item of expected) {
			const preset = MODEL_PRESETS.find((candidate) => candidate.id === item.presetId);

			assert.ok(preset);
			assert.strictEqual(preset.label, item.label);
			assert.strictEqual(preset.providerPresetId, "tokenrouter");
			assert.strictEqual(preset.model.id, item.modelId);
			assert.strictEqual(preset.model.owned_by, "tokenrouter");
			assert.strictEqual(preset.model.baseUrl, "https://api.tokenrouter.com/v1");
			assert.strictEqual(preset.model.apiMode, "openai");
			assert.strictEqual(preset.model.context_length, item.contextLength);
			assert.strictEqual(preset.model.max_tokens, item.maxTokens);
			assert.strictEqual(preset.model.max_completion_tokens, item.maxCompletionTokens);
			assert.strictEqual(preset.model.vision, item.vision);
			assert.strictEqual(preset.model.toolCalling, true);
			assert.strictEqual(preset.model.include_reasoning_in_request, true);
			assert.strictEqual(preset.model.reasoning_effort, item.defaultEffort);
			assert.deepStrictEqual(preset.model.supported_reasoning_efforts, item.effort);
			assert.strictEqual(preset.model.default_reasoning_effort, item.defaultEffort);
			assert.ok(preset.model._comment?.includes("https://www.tokenrouter.com/docs"));
		}

		const deepseek = MODEL_PRESETS.find((candidate) => candidate.id === "tokenrouter-deepseek-v4-pro-0813");
		const glm = MODEL_PRESETS.find((candidate) => candidate.id === "tokenrouter-glm-5-3");
		assert.ok(deepseek);
		assert.deepStrictEqual(deepseek.model.thinking, { type: "enabled" });
		assert.ok(glm);
		assert.deepStrictEqual(glm.model.thinking, { type: "enabled", clear_thinking: false });
	});

	test("contains Fireworks open-model quick setup presets", () => {
		const expected = [
			{
				presetId: "fireworks-deepseek-v4-pro",
				modelId: "accounts/fireworks/models/deepseek-v4-pro",
				contextLength: 1048576,
				maxTokens: 131072,
				vision: false,
				reasoningEffort: undefined,
				supportedReasoningEfforts: undefined,
				defaultReasoningEffort: undefined,
			},
			{
				presetId: "fireworks-kimi-k2-7-code",
				modelId: "accounts/fireworks/models/kimi-k2p7-code",
				contextLength: 262144,
				maxTokens: 32768,
				vision: true,
				reasoningEffort: undefined,
				supportedReasoningEfforts: undefined,
				defaultReasoningEffort: undefined,
			},
			{
				presetId: "fireworks-glm-5-2",
				modelId: "accounts/fireworks/models/glm-5p2",
				contextLength: 1048576,
				maxTokens: 131072,
				vision: false,
				reasoningEffort: "max",
				supportedReasoningEfforts: ["none", "high", "max"],
				defaultReasoningEffort: "max",
			},
		];

		for (const item of expected) {
			const preset = MODEL_PRESETS.find((candidate) => candidate.id === item.presetId);
			assert.ok(preset);
			assert.strictEqual(preset.providerPresetId, "fireworks");
			assert.strictEqual(preset.model.id, item.modelId);
			assert.strictEqual(preset.model.owned_by, "fireworks");
			assert.strictEqual(preset.model.baseUrl, "https://api.fireworks.ai/inference/v1");
			assert.strictEqual(preset.model.apiMode, "openai");
			assert.strictEqual(preset.model.context_length, item.contextLength);
			assert.strictEqual(preset.model.max_tokens, item.maxTokens);
			assert.strictEqual(preset.model.max_completion_tokens, undefined);
			assert.strictEqual(preset.model.vision, item.vision);
			assert.strictEqual(preset.model.toolCalling, true);
			assert.strictEqual(preset.model.include_reasoning_in_request, true);
			assert.deepStrictEqual(preset.model.prompt_cache, { enabled: true });
			assert.strictEqual(preset.model.reasoning_effort, item.reasoningEffort);
			assert.deepStrictEqual(preset.model.supported_reasoning_efforts, item.supportedReasoningEfforts);
			assert.strictEqual(preset.model.default_reasoning_effort, item.defaultReasoningEffort);
			assert.strictEqual(preset.model.thinking, undefined);
			assert.ok(preset.model._comment?.includes("https://app.fireworks.ai/models/fireworks/"));
		}
	});

	test("contains LiteLLM Kimi K2.6 quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "litellm-kimi-k2-6");

		assert.ok(preset);
		assert.strictEqual(preset.providerPresetId, "litellm");
		assert.strictEqual(preset.model.id, "Kimi-K2.6");
		assert.strictEqual(preset.model.owned_by, "litellm");
		assert.strictEqual(preset.model.baseUrl, "https://ai.nube.sh/api/v1");
		assert.strictEqual(preset.model.apiMode, "litellm");
		assert.deepStrictEqual(preset.model.extra_body, {
			thinking: {
				type: "enabled",
				keep: "all",
			},
		});
	});

	test("replaces the direct Z.AI GLM-5.2 card with GLM-5.3 and GLM-5.3-Flash", () => {
		const presets = MODEL_PRESETS.filter((preset) => preset.providerPresetId === "zai");
		assert.deepStrictEqual(
			presets.map((preset) => preset.id),
			["zai-glm-5-3", "zai-glm-5-3-flash"]
		);
		assert.deepStrictEqual(
			presets.map((preset) => preset.model.id),
			["glm-5.3", "glm-5.3-flash"]
		);
	});

	for (const expected of [
		{
			presetId: "zai-glm-5-3",
			label: "GLM-5.3",
			category: "latest",
			vision: false,
			source: "https://docs.z.ai/guides/llm/glm-5.3",
		},
		{
			presetId: "zai-glm-5-3-flash",
			label: "GLM-5.3-Flash",
			category: "fast",
			vision: true,
			source: "https://docs.z.ai/guides/vlm/glm-5.3-flash",
		},
	]) {
		test(`${expected.presetId} uses documented Z.AI Coding Plan defaults`, () => {
			const preset = MODEL_PRESETS.find((item) => item.id === expected.presetId);
			assert.ok(preset);
			assert.strictEqual(preset.label, expected.label);
			assert.strictEqual(preset.category, expected.category);
			assert.strictEqual(preset.tags.includes("Vision"), expected.vision);
			assert.ok(preset.model._comment?.includes(expected.source));
			assert.ok(preset.model._comment?.includes("https://docs.z.ai/devpack/latest-model"));
			assert.ok(preset.model._comment?.includes("https://docs.z.ai/api-reference/llm/chat-completion"));
			assert.strictEqual(preset.model.displayName, expected.label);
			assert.strictEqual(preset.model.owned_by, "zai");
			assert.strictEqual(preset.model.baseUrl, "https://api.z.ai/api/coding/paas/v4");
			assert.strictEqual(preset.model.apiMode, "openai");
			assert.strictEqual(preset.model.context_length, 1000000);
			assert.strictEqual(preset.model.max_tokens, 131072);
			assert.strictEqual(preset.model.max_completion_tokens, undefined);
			assert.strictEqual(preset.model.reasoning_effort, "max");
			assert.deepStrictEqual(preset.model.supported_reasoning_efforts, ["low", "high", "max"]);
			assert.strictEqual(preset.model.default_reasoning_effort, "max");
			assert.deepStrictEqual(preset.model.thinking, { type: "enabled", clear_thinking: false });
			assert.strictEqual(preset.model.vision, expected.vision);
			assert.strictEqual(preset.model.toolCalling, true);
			assert.strictEqual(preset.model.include_reasoning_in_request, true);
			assert.strictEqual(preset.model.temperature, 1);
			assert.strictEqual(preset.model.top_p, 0.95);
			assert.deepStrictEqual(preset.model.extra, { tool_stream: true });
			assert.strictEqual(preset.model.prompt_cache, undefined);
		});
	}

	test("Z.AI settings example matches the current save-ready catalog", () => {
		const file = path.join(__dirname, "../../examples/zai-glm.jsonc");
		const example = parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
		assert.strictEqual(example.error, undefined);
		assert.deepStrictEqual(
			example.config["oaicopilot.models"],
			MODEL_PRESETS.filter((preset) => preset.providerPresetId === "zai").map((preset) => ({
				...preset.model,
				providerPresetId: preset.providerPresetId,
			}))
		);
	});

	test("contains the six current LiteLLM gateway aliases", () => {
		const presets = MODEL_PRESETS.filter((preset) => preset.providerPresetId === "litellm");
		assert.deepStrictEqual(presets.map((preset) => preset.model.id).sort(), [
			"DeepSeek-V4.1-Flash",
			"GLM-5.3",
			"GLM-5.3-Flash",
			"Kimi-K2.6",
			"Kimi-K3",
			"Qwen3.8-27B",
		]);
		assert.strictEqual(new Set(MODEL_PRESETS.map((preset) => preset.id)).size, MODEL_PRESETS.length);
	});

	test("contains the LiteLLM Kimi K3 quick setup preset", () => {
		const preset = MODEL_PRESETS.find((item) => item.id === "litellm-kimi-k3");

		assert.ok(preset);
		assert.strictEqual(preset.label, "Kimi K3 (LiteLLM)");
		assert.strictEqual(preset.providerPresetId, "litellm");
		assert.strictEqual(preset.category, "latest");
		assert.deepStrictEqual(preset.tags, ["LiteLLM", "Kimi", "Code", "Vision", "Thinking", "Tools", "Prompt Cache"]);
		assert.strictEqual(preset.model.id, "Kimi-K3");
		assert.ok(preset.model._comment?.includes("https://platform.kimi.ai/docs/guide/kimi-k3-quickstart"));
		assert.strictEqual(preset.model.displayName, "Kimi K3 (LiteLLM)");
		assert.strictEqual(preset.model.owned_by, "litellm");
		assert.strictEqual(preset.model.baseUrl, "https://ai.nube.sh/api/v1");
		assert.strictEqual(preset.model.apiMode, "litellm");
		assert.strictEqual(preset.model.context_length, 1048576);
		assert.strictEqual(preset.model.max_completion_tokens, 131072);
		assert.strictEqual(preset.model.max_tokens, undefined);
		assert.strictEqual(preset.model.reasoning_effort, "max");
		assert.deepStrictEqual(preset.model.supported_reasoning_efforts, ["max"]);
		assert.strictEqual(preset.model.default_reasoning_effort, "max");
		assert.strictEqual(preset.model.vision, true);
		assert.strictEqual(preset.model.toolCalling, true);
		assert.strictEqual(preset.model.include_reasoning_in_request, true);
		assert.strictEqual(preset.model.thinking, undefined);
		assert.strictEqual(preset.model.prompt_cache, undefined);
	});

	for (const expected of [
		{
			presetId: "litellm-glm-5-3-flash",
			modelId: "GLM-5.3-Flash",
			label: "GLM-5.3-Flash (LiteLLM)",
			category: "fast",
			context: 1000000,
			output: 131072,
			vision: true,
			efforts: ["low", "high", "max"],
			defaultEffort: "max",
			thinking: undefined,
			temperature: 1,
			topP: 0.95,
			source: "https://docs.z.ai/guides/vlm/glm-5.3-flash",
		},
		{
			presetId: "litellm-glm-5-3",
			modelId: "GLM-5.3",
			label: "GLM-5.3 (LiteLLM)",
			category: "latest",
			context: 1000000,
			output: 131072,
			vision: false,
			efforts: ["low", "high", "max"],
			defaultEffort: "max",
			thinking: undefined,
			temperature: 1,
			topP: 0.95,
			source: "https://docs.z.ai/guides/llm/glm-5.3",
		},
		{
			presetId: "litellm-deepseek-v4-1-flash",
			modelId: "DeepSeek-V4.1-Flash",
			label: "DeepSeek V4.1 Flash (LiteLLM)",
			category: "fast",
			context: 1048576,
			output: 393216,
			vision: true,
			efforts: ["low", "high", "max"],
			defaultEffort: "max",
			thinking: { type: "enabled" },
			temperature: undefined,
			topP: undefined,
			source: "https://api-docs.deepseek.com/api/create-chat-completion",
		},
		{
			presetId: "litellm-qwen3-8-27b",
			modelId: "Qwen3.8-27B",
			label: "Qwen3.8-27B (LiteLLM)",
			category: "fast",
			context: 262144,
			output: 65536,
			vision: true,
			efforts: ["low", "medium", "xhigh"],
			defaultEffort: "xhigh",
			thinking: undefined,
			temperature: 1,
			topP: 0.95,
			source: "https://huggingface.co/Qwen/Qwen3.8-27B",
		},
	]) {
		test(`provides documented LiteLLM defaults for ${expected.modelId}`, () => {
			const preset = MODEL_PRESETS.find((item) => item.id === expected.presetId);
			assert.ok(preset);
			assert.strictEqual(preset.providerPresetId, "litellm");
			assert.strictEqual(preset.label, expected.label);
			assert.strictEqual(preset.category, expected.category);
			assert.ok(preset.tags.includes("LiteLLM"));
			assert.ok(preset.tags.includes("Tools"));
			assert.strictEqual(preset.tags.includes("Vision"), expected.vision);

			const model = preset.model;
			assert.strictEqual(model.id, expected.modelId);
			assert.strictEqual(model.displayName, expected.label);
			assert.strictEqual(model.owned_by, "litellm");
			assert.strictEqual(model.baseUrl, "https://ai.nube.sh/api/v1");
			assert.strictEqual(model.apiMode, "litellm");
			assert.strictEqual(model.context_length, expected.context);
			assert.strictEqual(model.max_tokens, expected.output);
			assert.strictEqual(model.max_completion_tokens, undefined);
			assert.strictEqual(model.vision, expected.vision);
			assert.strictEqual(model.toolCalling, true);
			assert.strictEqual(model.include_reasoning_in_request, true);
			assert.strictEqual(model.reasoning_effort, expected.defaultEffort);
			assert.strictEqual(model.default_reasoning_effort, expected.defaultEffort);
			assert.deepStrictEqual(model.supported_reasoning_efforts, expected.efforts);
			assert.deepStrictEqual(model.thinking, expected.thinking);
			assert.strictEqual(model.temperature, expected.temperature);
			assert.strictEqual(model.top_p, expected.topP);
			assert.strictEqual(model.enable_thinking, undefined);
			assert.strictEqual(model.extra_body, undefined);
			assert.strictEqual(model.prompt_cache, undefined);
			assert.ok(model._comment?.includes(expected.source));
		});
	}

	test("LiteLLM settings example matches the current save-ready catalog", () => {
		const file = path.join(__dirname, "../../examples/litellm.jsonc");
		const example = parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
		assert.strictEqual(example.error, undefined);
		assert.deepStrictEqual(
			example.config["oaicopilot.models"],
			MODEL_PRESETS.filter((preset) => preset.providerPresetId === "litellm").map((preset) => ({
				...preset.model,
				providerPresetId: preset.providerPresetId,
			}))
		);
	});

	test("omits retired LiteLLM quick setup presets", () => {
		for (const presetId of [
			"litellm-glm-5-1",
			"litellm-glm-5-2",
			"litellm-qwen3-5-122b-a10b",
			"litellm-deepseek-v4-flash",
		]) {
			assert.strictEqual(
				MODEL_PRESETS.some((preset) => preset.id === presetId),
				false
			);
		}
	});

	test("uses config IDs to keep duplicate model IDs saveable", () => {
		const fullIds = MODEL_PRESETS.map((preset) => {
			const model = preset.model;
			return `${model.id}${model.configId ? "::" + model.configId : ""}`;
		});
		assert.strictEqual(new Set(fullIds).size, fullIds.length);
	});

	test("enables Anthropic cache control for Anthropic-mode presets", () => {
		const anthropicPresets = MODEL_PRESETS.filter((preset) => preset.model.apiMode === "anthropic");
		assert.ok(anthropicPresets.length > 0, "expected Anthropic-mode presets");

		for (const preset of anthropicPresets) {
			assert.strictEqual(preset.model.prompt_cache?.enabled, true, `${preset.id} should enable prompt cache shaping`);
			assert.strictEqual(
				preset.model.prompt_cache?.anthropic?.enabled,
				true,
				`${preset.id} should enable Anthropic cache_control`
			);
		}
	});
});

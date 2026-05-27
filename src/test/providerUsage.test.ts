import * as assert from "assert";
import {
	checkProviderUsage,
	formatDuration,
	getProviderUsageAdapter,
	getProviderUsageSecretKey,
	getProviderUsageUnsupportedReason,
	parseAnthropicCostReport,
	parseDeepSeekBalance,
	parseKimiBalance,
	parseMiniMaxTokenPlan,
	parseOpenAICosts,
} from "../providerUsage";

suite("providerUsage", () => {
	test("parses DeepSeek balance response", () => {
		const result = parseDeepSeekBalance({
			is_available: true,
			balance_infos: [
				{
					currency: "USD",
					total_balance: "12.34",
					granted_balance: "2.34",
					topped_up_balance: "10.00",
				},
			],
		});

		assert.strictEqual(result.summary, "USD 12.34 available (grant 2.34, top-up 10.00) - available for API calls");
		assert.deepStrictEqual(result.details, [
			"Available for API calls: yes",
			"USD: total 12.34, grant 2.34, top-up 10.00",
		]);
	});

	test("parses Kimi balance response", () => {
		const result = parseKimiBalance({
			code: 0,
			data: {
				available_balance: 49.58894,
				voucher_balance: 46.58893,
				cash_balance: 3.00001,
			},
			scode: "0x0",
			status: true,
		});

		assert.strictEqual(result.summary, "49.58894 available (cash 3.00001, voucher 46.58893)");
		assert.deepStrictEqual(result.details, [
			"Available balance: 49.58894",
			"Cash balance: 3.00001",
			"Voucher balance: 46.58893",
		]);
	});

	test("parses MiniMax token plan usage as used counts", () => {
		const result = parseMiniMaxTokenPlan({
			base_resp: {
				status_code: 0,
				status_msg: "success",
			},
			model_remains: [
				{
					model_name: "MiniMax-M*",
					remains_time: 7_151_954,
					current_interval_total_count: 1500,
					current_interval_usage_count: 228,
					current_weekly_total_count: 15000,
					current_weekly_usage_count: 2000,
					weekly_remains_time: 248_351_954,
				},
			],
		});

		assert.strictEqual(result.summary, "MiniMax-M*: 1.3K left / 1.5K (15.2% used), resets in 1h 59m");
		assert.deepStrictEqual(result.details, [
			"MiniMax-M*: 1.3K left / 1.5K (15.2% used), resets in 1h 59m",
			"MiniMax-M* weekly: 13K left / 15K (13.3% used), resets in 2d 20h",
		]);
	});

	test("parses OpenAI organization costs", () => {
		const result = parseOpenAICosts({
			object: "page",
			data: [
				{
					object: "bucket",
					start_time: 1730419200,
					end_time: 1730505600,
					results: [
						{
							object: "organization.costs.result",
							amount: {
								value: 0.06,
								currency: "usd",
							},
							line_item: "Image models",
							project_id: null,
						},
						{
							object: "organization.costs.result",
							amount: {
								value: 1.2,
								currency: "usd",
							},
							line_item: "Text tokens",
							project_id: null,
						},
					],
				},
			],
			has_more: false,
			next_page: null,
		});

		assert.strictEqual(result.summary, "USD 1.26 spent in reported period (remaining credit not exposed)");
		assert.deepStrictEqual(result.details, [
			"Source: OpenAI organization costs API.",
			"Remaining credit balance: not exposed by the OpenAI usage/cost API.",
			"Image models: USD 0.06",
			"Text tokens: USD 1.2",
		]);
	});

	test("parses Anthropic cost report minor units", () => {
		const result = parseAnthropicCostReport({
			data: [
				{
					starting_at: "2025-08-01T00:00:00Z",
					ending_at: "2025-08-02T00:00:00Z",
					results: [
						{
							amount: "123.78912",
							currency: "USD",
							description: "Claude Sonnet 4 Usage - Input Tokens",
							cost_type: "tokens",
						},
						{
							amount: "12",
							currency: "USD",
							description: "Web Search Usage",
							cost_type: "web_search",
						},
					],
				},
			],
			has_more: false,
			next_page: null,
		});

		assert.strictEqual(result.summary, "USD 1.35789 spent in reported period (remaining credit not exposed)");
		assert.deepStrictEqual(result.details, [
			"Source: Anthropic cost report API.",
			"Amounts converted from Anthropic minor currency units.",
			"Remaining credit balance: not exposed by the Anthropic usage/cost API.",
			"Claude Sonnet 4 Usage - Input Tokens: USD 1.23789",
			"Web Search Usage: USD 0.12",
		]);
	});

	test("detects OpenAI and Anthropic usage adapters", () => {
		assert.strictEqual(getProviderUsageAdapter("openai", "https://api.openai.com/v1"), "openai");
		assert.strictEqual(getProviderUsageAdapter("custom", "https://api.anthropic.com"), "anthropic");
		assert.strictEqual(getProviderUsageAdapter("minimax-anthropic", "https://api.minimax.io/anthropic"), "minimax");
		assert.strictEqual(getProviderUsageSecretKey("OpenAI"), "oaicopilot.usageApiKey.openai");
	});

	test("detects MiMo as unsupported for provider usage checks", async () => {
		assert.strictEqual(getProviderUsageAdapter("mimo", "https://api.xiaomimimo.com/v1"), undefined);
		assert.strictEqual(getProviderUsageAdapter("custom", "https://token-plan-sgp.xiaomimimo.com/v1"), undefined);
		assert.match(
			getProviderUsageUnsupportedReason("mimo", "https://api.xiaomimimo.com/v1") ?? "",
			/Xiaomi MiMo usage checks are unavailable/
		);
		assert.match(
			getProviderUsageUnsupportedReason("custom", "https://token-plan-sgp.xiaomimimo.com/v1") ?? "",
			/web Console endpoints/
		);
		await assert.rejects(
			checkProviderUsage({
				provider: "mimo",
				baseUrl: "https://api.xiaomimimo.com/v1",
				apiKey: "test",
			}),
			/Xiaomi MiMo usage checks are unavailable/
		);
	});

	test("formats non-positive reset times as now", () => {
		assert.strictEqual(formatDuration(0), "now");
		assert.strictEqual(formatDuration(-1), "now");
	});
});

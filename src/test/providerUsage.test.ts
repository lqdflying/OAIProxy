import * as assert from "assert";
import {
	checkProviderUsage,
	buildFireworksBillingUsageEndpoint,
	buildLiteLLMKeyInfoEndpoint,
	formatDuration,
	getProviderUsageAdapter,
	getProviderUsageSecretKey,
	getProviderUsageUnsupportedReason,
	parseAnthropicCostReport,
	parseDeepSeekBalance,
	parseFireworksAccounts,
	parseFireworksBillingUsage,
	parseKimiBalance,
	parseMiniMaxTokenPlan,
	parseLiteLLMKeyInfo,
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
		assert.strictEqual(getProviderUsageAdapter("litellm", "https://ai.nube.sh/api/v1"), "litellm");
		assert.strictEqual(getProviderUsageAdapter("fireworks", "https://api.fireworks.ai/inference/v1"), "fireworks");
		assert.strictEqual(getProviderUsageAdapter("custom", "https://api.fireworks.ai/inference/v1"), "fireworks");
		assert.strictEqual(getProviderUsageSecretKey("OpenAI"), "oaicopilot.usageApiKey.openai");
	});

	test("parses Fireworks accounts and serverless billing usage", () => {
		assert.deepStrictEqual(
			parseFireworksAccounts({
				accounts: [
					{
						name: "accounts/team-a",
						displayName: "Team A",
					},
				],
				nextPageToken: "next",
			}),
			{
				accounts: [
					{
						name: "accounts/team-a",
						displayName: "Team A",
					},
				],
				nextPageToken: "next",
			}
		);
		assert.deepStrictEqual(
			parseFireworksBillingUsage({
				serverlessCosts: [
					{
						promptTokens: "1842301",
						completionTokens: "412980",
						group: {
							model_name: "accounts/fireworks/models/kimi-k2p7-code",
						},
					},
				],
			}),
			[
				{
					modelName: "accounts/fireworks/models/kimi-k2p7-code",
					promptTokens: 1842301,
					completionTokens: 412980,
				},
			]
		);
		assert.deepStrictEqual(parseFireworksBillingUsage({}), []);
		assert.strictEqual(
			buildFireworksBillingUsageEndpoint("accounts/team-a", new Date("2026-06-20T10:00:00.000Z")),
			"https://api.fireworks.ai/v1/accounts/team-a/billingUsage?startTime=2026-06-01T00%3A00%3A00.000Z&endTime=2026-06-20T10%3A00%3A00.000Z&usageType=SERVERLESS&groupBy=model_name"
		);
	});

	test("aggregates Fireworks usage across discovered accounts", async () => {
		const originalFetch = globalThis.fetch;
		const requestedUrls: string[] = [];
		globalThis.fetch = async (input) => {
			const url = String(input);
			requestedUrls.push(url);
			if (url.startsWith("https://api.fireworks.ai/v1/accounts?")) {
				return new Response(JSON.stringify({
					accounts: [
						{ name: "accounts/team-a", displayName: "Team A" },
						{ name: "accounts/team-b" },
					],
				}), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/accounts/team-a/billingUsage?")) {
				return new Response(JSON.stringify({
					serverlessCosts: [
						{
							promptTokens: "1200",
							completionTokens: "300",
							group: { model_name: "accounts/fireworks/models/deepseek-v4-pro" },
						},
					],
				}), { status: 200 });
			}
			if (url.includes("/accounts/team-b/billingUsage?")) {
				return new Response(JSON.stringify({
					serverlessCosts: [
						{
							promptTokens: "800",
							completionTokens: "200",
							group: { model_name: "accounts/fireworks/models/glm-5p2" },
						},
					],
				}), { status: 200 });
			}
			return new Response("not found", { status: 404, statusText: "Not Found" });
		};

		try {
			const result = await checkProviderUsage({
				provider: "fireworks",
				baseUrl: "https://api.fireworks.ai/inference/v1",
				apiKey: "fw-test",
			});

			assert.strictEqual(result.adapter, "fireworks");
			assert.strictEqual(result.summary, "2K input + 500 output tokens month-to-date across 2 accounts");
			assert.ok(result.details.some((line) => line.includes("Team A (accounts/team-a)")));
			assert.ok(result.details.some((line) => line.includes("accounts/team-b")));
			assert.strictEqual(requestedUrls.length, 3);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("rejects malformed Fireworks account responses", () => {
		assert.throws(() => parseFireworksAccounts({ accounts: "invalid" }), /Fireworks accounts must be an array/);
		assert.throws(
			() => parseFireworksBillingUsage({ serverlessCosts: [{ promptTokens: "bad", completionTokens: "1" }] }),
			/Fireworks promptTokens must be a number/
		);
	});

	test("parses LiteLLM key info and builds management endpoint", () => {
		const result = parseLiteLLMKeyInfo({
			info: {
				key_alias: "default",
				spend: 2.5,
				max_budget: 10,
				budget_duration: "30d",
				models: ["Kimi-K2.6"],
			},
		});

		assert.strictEqual(result.summary, "USD 7.5 remaining / USD 10 budget (USD 2.5 spent)");
		assert.deepStrictEqual(result.details, [
			"Key: default",
			"Spend: USD 2.5",
			"Budget: USD 10",
			"Remaining: USD 7.5",
			"Budget duration: 30d",
			"Models: Kimi-K2.6",
		]);
		assert.strictEqual(
			buildLiteLLMKeyInfoEndpoint("https://ai.nube.sh/api/v1", "sk-test"),
			"https://ai.nube.sh/key/info?key=sk-test"
		);
		assert.strictEqual(
			buildLiteLLMKeyInfoEndpoint("https://proxy.example.test/v1/", "sk-test"),
			"https://proxy.example.test/key/info?key=sk-test"
		);
	});

	test("requires target provider key for LiteLLM usage checks", async () => {
		await assert.rejects(
			checkProviderUsage({
				provider: "litellm",
				baseUrl: "https://ai.nube.sh/api/v1",
				apiKey: "admin",
			}),
			/LiteLLM usage checks require the provider API key/
		);
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

	test("detects Z.AI as unsupported for provider usage checks", async () => {
		assert.strictEqual(getProviderUsageAdapter("zai", "https://api.z.ai/api/coding/paas/v4"), undefined);
		assert.strictEqual(getProviderUsageAdapter("custom", "https://api.z.ai/api/paas/v4"), undefined);
		assert.match(
			getProviderUsageUnsupportedReason("zai", "https://api.z.ai/api/coding/paas/v4") ?? "",
			/Z\.AI usage checks are unavailable/
		);
		assert.match(
			getProviderUsageUnsupportedReason("zhipu", "https://open.bigmodel.cn/api/paas/v4") ?? "",
			/public API-key usage or balance endpoint/
		);
		await assert.rejects(
			checkProviderUsage({
				provider: "zai",
				baseUrl: "https://api.z.ai/api/coding/paas/v4",
				apiKey: "test",
			}),
			/Z\.AI usage checks are unavailable/
		);
	});

	test("formats non-positive reset times as now", () => {
		assert.strictEqual(formatDuration(0), "now");
		assert.strictEqual(formatDuration(-1), "now");
	});
});

import * as assert from "assert";
import {
	checkProviderUsage,
	buildFireworksBillingUsageEndpoint,
	buildLiteLLMKeyInfoEndpoint,
	buildTokenRouterWalletEndpoint,
	formatDuration,
	getProviderUsageAdapter,
	getProviderUsageSecretKey,
	getProviderUsageUnsupportedReason,
	isAzureFoundryProvider,
	isTokenRouterProvider,
	parseAnthropicCostReport,
	parseDeepSeekBalance,
	parseFireworksAccounts,
	parseFireworksBillingUsage,
	parseKimiBalance,
	parseMiniMaxTokenPlan,
	parseLiteLLMKeyInfo,
	parseOpenAICosts,
	parseOpenAICodexUsage,
	parseXaiGrokUsage,
	parseTokenRouterWallet,
	providerRequiresUsageApiKey,
	OPENAI_CODEX_USAGE_ENDPOINT,
	XAI_GROK_BILLING_ENDPOINT,
} from "../providerUsage";

suite("providerUsage", () => {
	test("parses OpenAI Codex quota windows and credits", () => {
		const result = parseOpenAICodexUsage({
			plan_type: "plus",
			rate_limit: {
				primary_window: { limit_window_seconds: 10800, used_percent: 12.5, reset_at: 1730505600 },
				secondary_window: { limit_window_seconds: 604800, used_percent: 40, reset_at: 1731000000 },
			},
			credits: { balance: "3.5" },
		});
		assert.match(result.summary, /Primary 3h: 12.5% used/);
		assert.deepStrictEqual(result.details.slice(0, 2), [
			"Source: OpenAI Codex OAuth quota compatibility endpoint.",
			"Plan: plus",
		]);
		assert.match(result.details.join("\n"), /Credits balance: 3.5/);
	});

	test("checks OpenAI Codex quota with OAuth headers", async () => {
		const originalFetch = globalThis.fetch;
		let request: { url: string; headers: Record<string, string> } | undefined;
		globalThis.fetch = (async (input, init) => {
			request = { url: String(input), headers: (init?.headers ?? {}) as Record<string, string> };
			return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1 } } }), { status: 200 });
		}) as typeof fetch;
		try {
			assert.strictEqual(getProviderUsageAdapter("openai", "https://chatgpt.com/backend-api/codex"), "openai-codex");
			const result = await checkProviderUsage({
				provider: "openai",
				baseUrl: "https://chatgpt.com/backend-api/codex",
				apiKey: "oauth-token",
				accountId: "acct-test",
			});
			assert.strictEqual(result.adapter, "openai-codex");
			assert.strictEqual(request?.url, OPENAI_CODEX_USAGE_ENDPOINT);
			assert.strictEqual(request?.headers.Authorization, "Bearer oauth-token");
			assert.strictEqual(request?.headers["ChatGPT-Account-Id"], "acct-test");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("reports a re-login message when Codex quota rejects OAuth", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response("expired", { status: 401, statusText: "Unauthorized" })) as typeof fetch;
		try {
			await assert.rejects(
				checkProviderUsage({
					provider: "openai",
					baseUrl: "https://chatgpt.com/backend-api/codex",
					apiKey: "expired-token",
				}),
				/OpenAI Codex OAuth session expired/
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

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

	test("parses TokenRouter management wallet response", () => {
		const result = parseTokenRouterWallet({
			success: true,
			message: "",
			data: {
				topUpBalance: "120.50",
				voucherEfficientAmount: 30,
				toppedUpSpent: "80.25",
				voucherSpent: 10,
			},
		});

		assert.strictEqual(result.summary, "150.5 credits remaining (top-up 120.5, voucher 30)");
		assert.deepStrictEqual(result.details, [
			"Source: TokenRouter Management API self wallet endpoint.",
			"Remaining topped-up balance: 120.5",
			"Valid voucher balance: 30",
			"Total remaining credits: 150.5",
			"Topped-up spent: 80.25",
			"Voucher spent: 10",
		]);
	});

	test("rejects TokenRouter wallet errors and malformed balances", () => {
		assert.throws(
			() => parseTokenRouterWallet({ success: false, message: "management key has expired" }),
			/management key has expired/
		);
		assert.throws(
			() =>
				parseTokenRouterWallet({
					success: true,
					data: {
						topUpBalance: "bad",
						voucherEfficientAmount: 30,
						toppedUpSpent: 0,
						voucherSpent: 0,
					},
				}),
			/TokenRouter topUpBalance must be a number/
		);
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
		assert.strictEqual(getProviderUsageAdapter("tokenrouter", "https://api.tokenrouter.com/v1"), "tokenrouter");
		assert.strictEqual(getProviderUsageAdapter("xai", "https://cli-chat-proxy.grok.com/v1"), "xai");
		assert.strictEqual(providerRequiresUsageApiKey("tokenrouter"), true);
		assert.strictEqual(getProviderUsageSecretKey("OpenAI"), "oaicopilot.usageApiKey.openai");
	});

	test("parses xAI Grok weekly credit usage", () => {
		const result = parseXaiGrokUsage({
			subscription_tier: "SuperGrok Heavy",
			config: {
				creditUsagePercent: 28.4,
				currentPeriod: {
					type: "SUBSCRIPTION_PERIOD_WEEKLY",
					end: "2026-09-28T12:00:00Z",
				},
				prepaidBalance: { val: "1250" },
			},
		});

		assert.strictEqual(
			result.summary,
			"Weekly credit remaining: 71.6% (28.4% used), resets 2026-09-28T12:00:00Z"
		);
		assert.deepStrictEqual(result.details, [
			"Source: xAI Grok subscription billing endpoint.",
			"Plan: SuperGrok Heavy",
			"Weekly credit remaining: 71.6%",
			"Weekly credit used: 28.4%",
			"Weekly period ends: 2026-09-28T12:00:00Z",
			"Prepaid balance: USD 12.5",
		]);
	});

	test("checks xAI Grok usage with subscription proxy headers", async () => {
		const originalFetch = globalThis.fetch;
		let request: { url: string; headers: Record<string, string> } | undefined;
		globalThis.fetch = (async (input, init) => {
			request = {
				url: String(input),
				headers: (init?.headers ?? {}) as Record<string, string>,
			};
			return new Response(
				JSON.stringify({
					config: {
						creditUsagePercent: 12.5,
						currentPeriod: { type: "SUBSCRIPTION_PERIOD_WEEKLY" },
					},
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		try {
			const result = await checkProviderUsage({
				provider: "xai",
				baseUrl: "https://cli-chat-proxy.grok.com/v1",
				apiKey: "oauth-access-token",
			});
			assert.strictEqual(result.summary, "Weekly credit remaining: 87.5% (12.5% used)");
			assert.deepStrictEqual(request, {
				url: XAI_GROK_BILLING_ENDPOINT,
				headers: {
					Accept: "application/json",
					Authorization: "Bearer oauth-access-token",
					"Content-Type": "application/json",
					"x-grok-client-mode": "cli",
					"x-grok-client-version": "1.0.4",
				},
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
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
				return new Response(
					JSON.stringify({
						accounts: [{ name: "accounts/team-a", displayName: "Team A" }, { name: "accounts/team-b" }],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					}
				);
			}
			if (url.includes("/accounts/team-a/billingUsage?")) {
				return new Response(
					JSON.stringify({
						serverlessCosts: [
							{
								promptTokens: "1200",
								completionTokens: "300",
								group: { model_name: "accounts/fireworks/models/deepseek-v4-pro" },
							},
						],
					}),
					{ status: 200 }
				);
			}
			if (url.includes("/accounts/team-b/billingUsage?")) {
				return new Response(
					JSON.stringify({
						serverlessCosts: [
							{
								promptTokens: "800",
								completionTokens: "200",
								group: { model_name: "accounts/fireworks/models/glm-5p2" },
							},
						],
					}),
					{ status: 200 }
				);
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

	test("directs Azure Foundry usage checks to Azure monitoring with RBAC", async () => {
		const baseUrl = "https://resource.services.ai.azure.com/openai/v1";
		assert.strictEqual(isAzureFoundryProvider("azure-foundry", baseUrl), true);
		assert.strictEqual(isAzureFoundryProvider("custom", baseUrl), true);
		assert.strictEqual(getProviderUsageAdapter("azure-foundry", baseUrl), undefined);
		assert.match(getProviderUsageUnsupportedReason("azure-foundry", baseUrl) ?? "", /Azure Monitor/);
		assert.match(getProviderUsageUnsupportedReason("custom", baseUrl) ?? "", /Azure RBAC/);
		await assert.rejects(
			checkProviderUsage({
				provider: "azure-foundry",
				baseUrl,
				apiKey: "test",
			}),
			/Azure Foundry usage checks are unavailable/
		);
	});

	test("checks TokenRouter wallet with a management key", async () => {
		const originalFetch = globalThis.fetch;
		const requested: Array<{ url: string; authorization?: string }> = [];
		globalThis.fetch = (async (input, init) => {
			const headers = init?.headers as Record<string, string> | undefined;
			requested.push({
				url: String(input),
				authorization: headers?.Authorization,
			});
			return new Response(
				JSON.stringify({
					success: true,
					message: "",
					data: {
						topUpBalance: 12,
						voucherEfficientAmount: 3.5,
						toppedUpSpent: 4,
						voucherSpent: 1,
					},
				}),
				{ status: 200 }
			);
		}) as typeof fetch;

		assert.strictEqual(isTokenRouterProvider("tokenrouter", "https://api.tokenrouter.com/v1"), true);
		assert.strictEqual(isTokenRouterProvider("custom", "https://api.tokenrouter.com/v1"), true);
		assert.strictEqual(getProviderUsageAdapter("tokenrouter", "https://api.tokenrouter.com/v1"), "tokenrouter");
		assert.strictEqual(
			buildTokenRouterWalletEndpoint("https://api.tokenrouter.com/v1"),
			"https://api.tokenrouter.com/api/management/self/wallet"
		);
		try {
			assert.strictEqual(getProviderUsageUnsupportedReason("tokenrouter", "https://api.tokenrouter.com/v1"), undefined);
			const result = await checkProviderUsage({
				provider: "tokenrouter",
				baseUrl: "https://api.tokenrouter.com/v1",
				apiKey: "mgmt-test",
			});
			assert.strictEqual(result.adapter, "tokenrouter");
			assert.strictEqual(result.summary, "15.5 credits remaining (top-up 12, voucher 3.5)");
			assert.deepStrictEqual(requested, [
				{
					url: "https://api.tokenrouter.com/api/management/self/wallet",
					authorization: "Bearer mgmt-test",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("formats non-positive reset times as now", () => {
		assert.strictEqual(formatDuration(0), "now");
		assert.strictEqual(formatDuration(-1), "now");
	});
});

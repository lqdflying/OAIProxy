export type ProviderUsageAdapter = "anthropic" | "deepseek" | "kimi" | "litellm" | "minimax" | "openai";

export interface ProviderUsageResult {
	provider: string;
	adapter: ProviderUsageAdapter;
	checkedAt: string;
	summary: string;
	details: string[];
}

export interface ParsedProviderUsage {
	summary: string;
	details: string[];
}

export interface ProviderUsageRequest {
	provider: string;
	baseUrl?: string;
	apiKey: string;
	targetApiKey?: string;
}

const DEEPSEEK_BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance";
const KIMI_BALANCE_ENDPOINT = "https://api.moonshot.ai/v1/users/me/balance";
const MINIMAX_TOKEN_PLAN_ENDPOINT = "https://api.minimax.io/v1/token_plan/remains";
const OPENAI_COSTS_ENDPOINT = "https://api.openai.com/v1/organization/costs";
const ANTHROPIC_COST_REPORT_ENDPOINT = "https://api.anthropic.com/v1/organizations/cost_report";
const MIMO_USAGE_UNSUPPORTED_REASON =
	"Xiaomi MiMo usage checks are unavailable because Xiaomi only exposes balance/usage through web Console endpoints; no public API-key usage endpoint is documented.";

export function getProviderSecretKey(provider: string): string {
	return `oaicopilot.apiKey.${provider.trim().toLowerCase()}`;
}

export function getProviderUsageSecretKey(provider: string): string {
	return `oaicopilot.usageApiKey.${provider.trim().toLowerCase()}`;
}

export function providerRequiresUsageApiKey(adapter: ProviderUsageAdapter): boolean {
	return adapter === "openai" || adapter === "anthropic" || adapter === "litellm";
}

export function isMimoProvider(provider: string, baseUrl?: string): boolean {
	const normalizedProvider = provider.trim().toLowerCase();
	const normalizedBaseUrl = (baseUrl ?? "").trim().toLowerCase();
	return (
		normalizedProvider === "mimo" ||
		normalizedProvider === "xiaomi" ||
		normalizedProvider === "xiaomi-mimo" ||
		normalizedProvider === "xiaomimimo" ||
		normalizedBaseUrl.includes("xiaomimimo.com")
	);
}

export function getProviderUsageUnsupportedReason(provider: string, baseUrl?: string): string | undefined {
	if (isMimoProvider(provider, baseUrl)) {
		return MIMO_USAGE_UNSUPPORTED_REASON;
	}
	return undefined;
}

export function getProviderUsageAdapter(provider: string, baseUrl?: string): ProviderUsageAdapter | undefined {
	const normalizedProvider = provider.trim().toLowerCase();
	const normalizedBaseUrl = (baseUrl ?? "").trim().toLowerCase();

	if (normalizedProvider === "openai" || normalizedBaseUrl.includes("api.openai.com")) {
		return "openai";
	}
	if (normalizedProvider === "deepseek" || normalizedBaseUrl.includes("deepseek.com")) {
		return "deepseek";
	}
	if (
		normalizedProvider === "kimi" ||
		normalizedProvider === "moonshot" ||
		normalizedBaseUrl.includes("moonshot.ai") ||
		normalizedBaseUrl.includes("kimi.ai")
	) {
		return "kimi";
	}
	if (
		normalizedProvider === "minimax" ||
		normalizedProvider === "minimax-anthropic" ||
		normalizedBaseUrl.includes("minimax.io")
	) {
		return "minimax";
	}
	if (
		normalizedProvider === "anthropic" ||
		normalizedProvider === "claude" ||
		normalizedBaseUrl.includes("api.anthropic.com")
	) {
		return "anthropic";
	}
	if (
		normalizedProvider === "litellm" ||
		normalizedBaseUrl.includes("ai.nube.sh") ||
		normalizedBaseUrl.includes("litellm")
	) {
		return "litellm";
	}

	return undefined;
}

export async function checkProviderUsage(request: ProviderUsageRequest): Promise<ProviderUsageResult> {
	const adapter = getProviderUsageAdapter(request.provider, request.baseUrl);
	if (!adapter) {
		throw new Error(
			getProviderUsageUnsupportedReason(request.provider, request.baseUrl) ??
				`Provider ${request.provider} does not support usage checks yet.`
		);
	}

	let parsed: ParsedProviderUsage;
	if (adapter === "deepseek") {
		parsed = parseDeepSeekBalance(await fetchJson(DEEPSEEK_BALANCE_ENDPOINT, "DeepSeek", bearerHeaders(request.apiKey)));
	} else if (adapter === "kimi") {
		parsed = parseKimiBalance(await fetchJson(KIMI_BALANCE_ENDPOINT, "Kimi", bearerHeaders(request.apiKey)));
	} else if (adapter === "minimax") {
		parsed = parseMiniMaxTokenPlan(await fetchJson(MINIMAX_TOKEN_PLAN_ENDPOINT, "MiniMax", bearerHeaders(request.apiKey)));
	} else if (adapter === "openai") {
		parsed = parseOpenAICosts(await fetchJson(buildOpenAICostsEndpoint(), "OpenAI", bearerHeaders(request.apiKey)));
	} else if (adapter === "anthropic") {
		parsed = parseAnthropicCostReport(
			await fetchJson(buildAnthropicCostReportEndpoint(), "Anthropic", anthropicAdminHeaders(request.apiKey))
		);
	} else {
		if (!request.targetApiKey) {
			throw new Error("LiteLLM usage checks require the provider API key to inspect plus a separate master/admin Usage Key.");
		}
		parsed = parseLiteLLMKeyInfo(
			await fetchJson(buildLiteLLMKeyInfoEndpoint(request.baseUrl, request.targetApiKey), "LiteLLM", bearerHeaders(request.apiKey))
		);
	}

	return {
		provider: request.provider,
		adapter,
		checkedAt: new Date().toISOString(),
		summary: parsed.summary,
		details: parsed.details,
	};
}

export function parseDeepSeekBalance(payload: unknown): ParsedProviderUsage {
	const obj = asRecord(payload, "DeepSeek balance response");
	const balanceInfos = asArray(obj.balance_infos, "DeepSeek balance_infos");
	if (balanceInfos.length === 0) {
		throw new Error("DeepSeek balance response did not include any balance entries.");
	}

	const isAvailable = obj.is_available === true;
	const balances = balanceInfos.map((item) => {
		const balance = asRecord(item, "DeepSeek balance entry");
		const currency = asString(balance.currency, "DeepSeek currency");
		const totalBalance = asString(balance.total_balance, "DeepSeek total_balance");
		const grantedBalance = asString(balance.granted_balance, "DeepSeek granted_balance");
		const toppedUpBalance = asString(balance.topped_up_balance, "DeepSeek topped_up_balance");
		return {
			currency,
			totalBalance,
			grantedBalance,
			toppedUpBalance,
		};
	});

	const balanceSummary = balances
		.map(
			(balance) =>
				`${balance.currency} ${balance.totalBalance} available (grant ${balance.grantedBalance}, top-up ${balance.toppedUpBalance})`
		)
		.join("; ");
	const availability = isAvailable ? "available for API calls" : "not available for API calls";

	return {
		summary: `${balanceSummary} - ${availability}`,
		details: [
			`Available for API calls: ${isAvailable ? "yes" : "no"}`,
			...balances.map(
				(balance) =>
					`${balance.currency}: total ${balance.totalBalance}, grant ${balance.grantedBalance}, top-up ${balance.toppedUpBalance}`
			),
		],
	};
}

export function parseKimiBalance(payload: unknown): ParsedProviderUsage {
	const obj = asRecord(payload, "Kimi balance response");
	if (obj.status === false) {
		throw new Error(`Kimi balance check failed${typeof obj.scode === "string" ? ` (${obj.scode})` : ""}.`);
	}

	const data = asRecord(obj.data, "Kimi balance data");
	const availableBalance = asNumber(data.available_balance, "Kimi available_balance");
	const voucherBalance = asNumber(data.voucher_balance, "Kimi voucher_balance");
	const cashBalance = asNumber(data.cash_balance, "Kimi cash_balance");

	return {
		summary: `${formatDecimal(availableBalance)} available (cash ${formatDecimal(cashBalance)}, voucher ${formatDecimal(voucherBalance)})`,
		details: [
			`Available balance: ${formatDecimal(availableBalance)}`,
			`Cash balance: ${formatDecimal(cashBalance)}`,
			`Voucher balance: ${formatDecimal(voucherBalance)}`,
		],
	};
}

export function parseMiniMaxTokenPlan(payload: unknown): ParsedProviderUsage {
	const obj = asRecord(payload, "MiniMax Token Plan response");
	if (obj.base_resp !== undefined) {
		const baseResp = asRecord(obj.base_resp, "MiniMax base_resp");
		const statusCode = optionalNumber(baseResp.status_code, "MiniMax status_code");
		if (statusCode !== undefined && statusCode !== 0) {
			const statusMessage = typeof baseResp.status_msg === "string" ? baseResp.status_msg : "unknown error";
			throw new Error(`MiniMax Token Plan check failed: ${statusMessage} (${statusCode}).`);
		}
	}

	const modelRemains = asArray(obj.model_remains, "MiniMax model_remains");
	if (modelRemains.length === 0) {
		throw new Error("MiniMax Token Plan response did not include any quota entries.");
	}

	const rows = modelRemains.map((item) => {
		const model = asRecord(item, "MiniMax quota entry");
		const modelName = asString(model.model_name, "MiniMax model_name");
		const total = asNumber(model.current_interval_total_count, "MiniMax current_interval_total_count");
		const used = asNumber(model.current_interval_usage_count, "MiniMax current_interval_usage_count");
		const remaining = Math.max(total - used, 0);
		const resetMs = optionalNumber(model.remains_time, "MiniMax remains_time");
		const weeklyTotal = optionalNumber(model.current_weekly_total_count, "MiniMax current_weekly_total_count");
		const weeklyUsed = optionalNumber(model.current_weekly_usage_count, "MiniMax current_weekly_usage_count");
		const weeklyResetMs = optionalNumber(model.weekly_remains_time, "MiniMax weekly_remains_time");
		const intervalText = `${modelName}: ${formatCount(remaining)} left / ${formatCount(total)} (${formatPercent(used, total)} used)${
			resetMs !== undefined ? `, resets in ${formatDuration(resetMs)}` : ""
		}`;

		let weeklyText: string | undefined;
		if (weeklyTotal !== undefined && weeklyUsed !== undefined && weeklyTotal > 0) {
			const weeklyRemaining = Math.max(weeklyTotal - weeklyUsed, 0);
			weeklyText = `${modelName} weekly: ${formatCount(weeklyRemaining)} left / ${formatCount(weeklyTotal)} (${formatPercent(
				weeklyUsed,
				weeklyTotal
			)} used)${weeklyResetMs !== undefined ? `, resets in ${formatDuration(weeklyResetMs)}` : ""}`;
		}

		return {
			intervalText,
			weeklyText,
		};
	});

	const details = rows.flatMap((row) => (row.weeklyText ? [row.intervalText, row.weeklyText] : [row.intervalText]));
	const summary = rows.length === 1 ? rows[0].intervalText : `${rows[0].intervalText}; +${rows.length - 1} more`;

	return {
		summary,
		details,
	};
}

export function parseOpenAICosts(payload: unknown): ParsedProviderUsage {
	const obj = asRecord(payload, "OpenAI costs response");
	const buckets = asArray(obj.data, "OpenAI costs data");
	const totals = new Map<string, number>();
	const lineTotals = new Map<string, Map<string, number>>();

	for (const bucketItem of buckets) {
		const bucket = asRecord(bucketItem, "OpenAI costs bucket");
		const results = asArray(bucket.results, "OpenAI costs results");
		for (const resultItem of results) {
			const result = asRecord(resultItem, "OpenAI costs result");
			const amount = asRecord(result.amount, "OpenAI costs amount");
			const currency = asString(amount.currency, "OpenAI costs currency").toUpperCase();
			const value = asNumber(amount.value, "OpenAI costs value");
			const lineItem = typeof result.line_item === "string" && result.line_item.trim() ? result.line_item : "Ungrouped costs";
			addCurrencyTotal(totals, currency, value);
			addBreakdownTotal(lineTotals, lineItem, currency, value);
		}
	}

	return {
		summary: formatCostSummary(totals),
		details: [
			"Source: OpenAI organization costs API.",
			"Remaining credit balance: not exposed by the OpenAI usage/cost API.",
			...formatBreakdownTotals(lineTotals),
		],
	};
}

export function parseAnthropicCostReport(payload: unknown): ParsedProviderUsage {
	const obj = asRecord(payload, "Anthropic cost report response");
	const buckets = asArray(obj.data, "Anthropic cost report data");
	const totals = new Map<string, number>();
	const descriptionTotals = new Map<string, Map<string, number>>();

	for (const bucketItem of buckets) {
		const bucket = asRecord(bucketItem, "Anthropic cost report bucket");
		const results = asArray(bucket.results, "Anthropic cost report results");
		for (const resultItem of results) {
			const result = asRecord(resultItem, "Anthropic cost report result");
			const currency = asString(result.currency, "Anthropic cost report currency").toUpperCase();
			const value = asNumber(result.amount, "Anthropic cost report amount") / 100;
			const description =
				typeof result.description === "string" && result.description.trim()
					? result.description
					: typeof result.cost_type === "string" && result.cost_type.trim()
						? result.cost_type
						: "Ungrouped costs";
			addCurrencyTotal(totals, currency, value);
			addBreakdownTotal(descriptionTotals, description, currency, value);
		}
	}

	return {
		summary: formatCostSummary(totals),
		details: [
			"Source: Anthropic cost report API.",
			"Amounts converted from Anthropic minor currency units.",
			"Remaining credit balance: not exposed by the Anthropic usage/cost API.",
			...formatBreakdownTotals(descriptionTotals),
		],
	};
}

export function parseLiteLLMKeyInfo(payload: unknown): ParsedProviderUsage {
	const obj = asRecord(payload, "LiteLLM key info response");
	const info = obj.info !== undefined ? asRecord(obj.info, "LiteLLM key info") : obj;
	const alias = optionalString(info.key_alias) ?? optionalString(info.alias) ?? "virtual key";
	const spend = optionalNumber(info.spend, "LiteLLM spend") ?? optionalNumber(info.total_spend, "LiteLLM total_spend") ?? 0;
	const maxBudget =
		optionalNumber(info.max_budget, "LiteLLM max_budget") ??
		optionalNumber(info.budget, "LiteLLM budget") ??
		optionalNumber(info.soft_budget, "LiteLLM soft_budget");
	const remainingBudget =
		optionalNumber(info.remaining_budget, "LiteLLM remaining_budget") ??
		(maxBudget !== undefined ? Math.max(maxBudget - spend, 0) : undefined);
	const budgetDuration = optionalString(info.budget_duration);
	const models = Array.isArray(info.models)
		? info.models.map((item) => String(item)).filter(Boolean)
		: [];

	const summary =
		remainingBudget !== undefined && maxBudget !== undefined
			? `${formatMoney(remainingBudget, "USD")} remaining / ${formatMoney(maxBudget, "USD")} budget (${formatMoney(
					spend,
					"USD"
				)} spent)`
			: `${formatMoney(spend, "USD")} spent`;
	const details = [
		`Key: ${alias}`,
		`Spend: ${formatMoney(spend, "USD")}`,
	];
	if (maxBudget !== undefined) {
		details.push(`Budget: ${formatMoney(maxBudget, "USD")}`);
	}
	if (remainingBudget !== undefined) {
		details.push(`Remaining: ${formatMoney(remainingBudget, "USD")}`);
	}
	if (budgetDuration) {
		details.push(`Budget duration: ${budgetDuration}`);
	}
	if (models.length > 0) {
		details.push(`Models: ${models.join(", ")}`);
	}

	return { summary, details };
}

export function formatProviderUsageResult(result: ProviderUsageResult): string {
	return [
		`Provider: ${result.provider}`,
		`Type: ${result.adapter}`,
		`Checked: ${result.checkedAt}`,
		"",
		...result.details,
	].join("\n");
}

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) {
		return "now";
	}

	const totalSeconds = Math.ceil(ms / 1000);
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

function formatCount(value: number): string {
	if (value >= 1_000_000_000) {
		return `${trimFixed(value / 1_000_000_000)}B`;
	}
	if (value >= 1_000_000) {
		return `${trimFixed(value / 1_000_000)}M`;
	}
	if (value >= 1_000) {
		return `${trimFixed(value / 1_000)}K`;
	}
	return value.toLocaleString();
}

function formatDecimal(value: number): string {
	return trimFixed(value, 5);
}

function formatMoney(value: number, currency: string): string {
	return `${currency.toUpperCase()} ${formatDecimal(value)}`;
}

function addCurrencyTotal(totals: Map<string, number>, currency: string, value: number): void {
	totals.set(currency, (totals.get(currency) ?? 0) + value);
}

function addBreakdownTotal(totals: Map<string, Map<string, number>>, label: string, currency: string, value: number): void {
	let currencyTotals = totals.get(label);
	if (!currencyTotals) {
		currencyTotals = new Map<string, number>();
		totals.set(label, currencyTotals);
	}
	addCurrencyTotal(currencyTotals, currency, value);
}

function formatCurrencyTotals(totals: Map<string, number>): string {
	if (totals.size === 0) {
		return "No cost data";
	}
	return Array.from(totals.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([currency, value]) => formatMoney(value, currency))
		.join("; ");
}

function formatCostSummary(totals: Map<string, number>): string {
	if (totals.size === 0) {
		return "No cost data returned for reported period";
	}
	return `${formatCurrencyTotals(totals)} spent in reported period (remaining credit not exposed)`;
}

function formatBreakdownTotals(totals: Map<string, Map<string, number>>): string[] {
	if (totals.size === 0) {
		return ["Breakdown: no cost items returned."];
	}

	return Array.from(totals.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([label, currencyTotals]) => `${label}: ${formatCurrencyTotals(currencyTotals)}`);
}

function formatPercent(used: number, total: number): string {
	if (!Number.isFinite(total) || total <= 0) {
		return "0%";
	}
	return `${trimFixed(Math.min((used / total) * 100, 100), 1)}%`;
}

function trimFixed(value: number, digits = 1): string {
	const fixed = value.toFixed(digits);
	return fixed.replace(/\.?0+$/, "");
}

function bearerHeaders(apiKey: string): Record<string, string> {
	return {
		Accept: "application/json",
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};
}

function anthropicAdminHeaders(apiKey: string): Record<string, string> {
	return {
		Accept: "application/json",
		"anthropic-version": "2023-06-01",
		"Content-Type": "application/json",
		"x-api-key": apiKey,
	};
}

function buildOpenAICostsEndpoint(): string {
	const { start, end } = getMonthToDateRange();
	const params = new URLSearchParams({
		start_time: String(Math.floor(start.getTime() / 1000)),
		end_time: String(Math.ceil(end.getTime() / 1000)),
		bucket_width: "1d",
		limit: "31",
	});
	params.append("group_by", "line_item");
	return `${OPENAI_COSTS_ENDPOINT}?${params.toString()}`;
}

function buildAnthropicCostReportEndpoint(): string {
	const { start, end } = getMonthToDateRange();
	const params = new URLSearchParams({
		starting_at: toRfc3339(start),
		ending_at: toRfc3339(end),
		bucket_width: "1d",
		limit: "31",
	});
	params.append("group_by[]", "description");
	return `${ANTHROPIC_COST_REPORT_ENDPOINT}?${params.toString()}`;
}

export function buildLiteLLMKeyInfoEndpoint(baseUrl: string | undefined, targetApiKey: string): string {
	const trimmed = (baseUrl ?? "").trim();
	if (!trimmed) {
		throw new Error("LiteLLM usage checks require a configured provider Base URL.");
	}
	const normalized = trimmed.replace(/\/+$/, "");
	const managementBaseUrl = normalized.endsWith("/api/v1")
		? normalized.slice(0, -"/api/v1".length)
		: normalized.endsWith("/v1")
			? normalized.slice(0, -"/v1".length)
			: normalized;
	const params = new URLSearchParams({ key: targetApiKey });
	return `${managementBaseUrl}/key/info?${params.toString()}`;
}

function getMonthToDateRange(now = new Date()): { start: Date; end: Date } {
	return {
		start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)),
		end: now,
	};
}

function toRfc3339(date: Date): string {
	return date.toISOString().replace(".000Z", "Z");
}

async function fetchJson(endpoint: string, providerLabel: string, headers: Record<string, string>): Promise<unknown> {
	const response = await fetch(endpoint, {
		method: "GET",
		headers,
	});
	const text = await response.text();

	if (!response.ok) {
		throw new Error(
			`${providerLabel} usage check failed: [${response.status}] ${response.statusText}${text ? `\n${truncate(text)}` : ""}`
		);
	}

	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(
			`${providerLabel} usage check returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function truncate(text: string, maxLength = 1000): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array.`);
	}
	return value;
}

function asString(value: unknown, label: string): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	throw new Error(`${label} must be a string.`);
}

function asNumber(value: unknown, label: string): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	throw new Error(`${label} must be a number.`);
}

function optionalNumber(value: unknown, label: string): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	return asNumber(value, label);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

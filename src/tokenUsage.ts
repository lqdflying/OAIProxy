import * as vscode from "vscode";
import { LanguageModelChatInformation, LanguageModelChatRequestMessage, LanguageModelChatTool } from "vscode";
import { type CacheUsageRecord, getLatestCacheUsage } from "./cacheUsage";
import { countMessageTokenDetails, countToolTokens, type MessageTokenDetails } from "./provideToken";
import { isToolResultPart, mapRole } from "./utils";

export type TokenUsageCategoryId =
	| "systemContext"
	| "currentPrompt"
	| "conversationHistory"
	| "toolDefinitions"
	| "toolTraffic"
	| "media"
	| "reasoning";

export type TokenUsageStatus = "ok" | "warning" | "error";

export interface TokenUsageCategory {
	id: TokenUsageCategoryId;
	label: string;
	tokens: number;
}

export interface TokenUsageReport {
	modelId: string;
	modelName: string;
	messageCount: number;
	toolCount: number;
	messageTokens: number;
	toolDefinitionTokens: number;
	inputTokens: number;
	maxInputTokens: number;
	maxOutputTokens: number;
	maxContextTokens: number;
	inputUsagePercent: number;
	contextUsagePercent: number;
	currentUserMessageIndex: number;
	categories: TokenUsageCategory[];
	status: TokenUsageStatus;
	generatedAt: string;
	note: string;
}

export interface TokenUsageReportRequest {
	messages: readonly LanguageModelChatRequestMessage[];
	tools: readonly LanguageModelChatTool[] | undefined;
	model: LanguageModelChatInformation;
	modelConfig: { includeReasoningInRequest: boolean };
}

export interface TokenUsageEstimator {
	countMessageDetails(
		message: LanguageModelChatRequestMessage,
		modelConfig: { includeReasoningInRequest: boolean }
	): Promise<MessageTokenDetails>;
	countToolDefinitions(tools: readonly LanguageModelChatTool[]): Promise<number>;
}

const DEFAULT_NOTE =
	"Best-effort estimate. VS Code exposes the assembled request, so project context is grouped with system/context messages when it is not separately labeled.";

const CORE_CATEGORY_IDS = new Set<TokenUsageCategoryId>([
	"systemContext",
	"currentPrompt",
	"conversationHistory",
	"toolDefinitions",
	"toolTraffic",
]);

const defaultEstimator: TokenUsageEstimator = {
	countMessageDetails: countMessageTokenDetails,
	countToolDefinitions: countToolTokens,
};

export async function createTokenUsageReport(
	request: TokenUsageReportRequest,
	estimator: TokenUsageEstimator = defaultEstimator
): Promise<TokenUsageReport> {
	const categories = createTokenUsageCategories();
	const currentUserMessageIndex = findCurrentUserPromptIndex(request.messages);
	let messageTokens = 0;

	for (let index = 0; index < request.messages.length; index++) {
		const message = request.messages[index];
		const details = await estimator.countMessageDetails(message, request.modelConfig);
		messageTokens += details.totalTokens;
		addMessageDetailsToCategories(categories, message, index, currentUserMessageIndex, details);
	}

	const toolCount = request.tools?.length ?? 0;
	const toolDefinitionTokens = toolCount > 0 ? await estimator.countToolDefinitions(request.tools ?? []) : 0;
	addCategoryTokens(categories, "toolDefinitions", toolDefinitionTokens);

	const inputTokens = messageTokens + toolDefinitionTokens;
	const maxInputTokens = Math.max(0, request.model.maxInputTokens);
	const maxOutputTokens = Math.max(0, request.model.maxOutputTokens);
	const maxContextTokens = maxInputTokens + maxOutputTokens;
	const inputUsagePercent = calculatePercentage(inputTokens, maxInputTokens);
	const contextUsagePercent = calculatePercentage(inputTokens, maxContextTokens);

	return {
		modelId: request.model.id,
		modelName: request.model.name,
		messageCount: request.messages.length,
		toolCount,
		messageTokens,
		toolDefinitionTokens,
		inputTokens,
		maxInputTokens,
		maxOutputTokens,
		maxContextTokens,
		inputUsagePercent,
		contextUsagePercent,
		currentUserMessageIndex,
		categories,
		status: getTokenUsageStatus(inputUsagePercent),
		generatedAt: new Date().toISOString(),
		note: DEFAULT_NOTE,
	};
}

/**
 * Format number to thousands (K, M, B) format.
 * @param value The number to format.
 * @returns Formatted string (e.g., "2.3K", "168.0K").
 */
export function formatTokenCount(value: number): string {
	if (value >= 1_000_000_000) {
		return (value / 1_000_000_000).toFixed(1) + "B";
	} else if (value >= 1_000_000) {
		return (value / 1_000_000).toFixed(1) + "M";
	} else if (value >= 1_000) {
		return (value / 1_000).toFixed(1) + "K";
	}
	return value.toLocaleString();
}

/**
 * Format token usage as a compact percentage for status bar display.
 * @param usedTokens Tokens used.
 * @param maxTokens Maximum tokens available.
 * @returns Percentage string (e.g., "75.2%").
 */
export function createProgressBar(usedTokens: number, maxTokens: number): string {
	if (maxTokens <= 0) {
		return "0.0%";
	}

	const usagePercentage = Math.max(0, (usedTokens / maxTokens) * 100);
	return `${usagePercentage.toFixed(1)}%`;
}

export function formatTokenPercentage(value: number, maxTokens: number): string {
	if (maxTokens <= 0) {
		return "0.0%";
	}
	return `${calculatePercentage(value, maxTokens).toFixed(1)}%`;
}

export function formatTokenUsageTooltip(report: TokenUsageReport): vscode.MarkdownString {
	const cacheUsage = getLatestCacheUsage(report.modelId) ?? getLatestCacheUsage();
	const warning = getWarningText(report);
	const markdown = new vscode.MarkdownString(undefined, true);
	markdown.supportThemeIcons = true;
	markdown.appendMarkdown(`$(copilot) **OAIProxy**\n\n`);
	markdown.appendMarkdown(`**${formatTokenPercentage(report.inputTokens, report.maxContextTokens)}** of context used\n\n`);
	markdown.appendMarkdown(
		`${formatTokenCount(report.inputTokens)} / ${formatTokenCount(report.maxContextTokens)} context · ${formatTokenCount(report.maxOutputTokens)} output reserve\n\n`
	);
	markdown.appendMarkdown("---\n\n");
	markdown.appendMarkdown(
		`$(graph-line) **Input budget** ${formatTokenPercentage(report.inputTokens, report.maxInputTokens)} · ${formatTokenCount(report.inputTokens)} / ${formatTokenCount(report.maxInputTokens)}\n\n`
	);
	markdown.appendMarkdown(`${formatCacheUsageSummary(cacheUsage, report)}\n\n`);
	markdown.appendMarkdown("---\n\n");
	markdown.appendMarkdown(`$(list-tree) **Breakdown**\n\n`);
	for (const line of formatTooltipBreakdownLines(report)) {
		markdown.appendMarkdown(`${line}\n\n`);
	}

	if (warning) {
		markdown.appendMarkdown(`\n$(warning) ${warning}\n`);
	}

	markdown.appendMarkdown(`$(gear) Click to open OAIProxy Configuration`);
	return markdown;
}

export function formatTokenUsageDetails(report: TokenUsageReport): string {
	const lines = [
		"OAIProxy Token Usage",
		`Model: ${report.modelName} (${report.modelId})`,
		`Generated: ${report.generatedAt}`,
		"",
		`Input Tokens: ${formatTokenCount(report.inputTokens)} / ${formatTokenCount(report.maxInputTokens)} (${formatTokenPercentage(report.inputTokens, report.maxInputTokens)})`,
		`Context Window: ${formatTokenCount(report.inputTokens)} / ${formatTokenCount(report.maxContextTokens)} (${formatTokenPercentage(report.inputTokens, report.maxContextTokens)})`,
		`Output Reserve: ${formatTokenCount(report.maxOutputTokens)}`,
		`Messages: ${report.messageCount}`,
		`Tools: ${report.toolCount}`,
		"",
		...formatCacheUsageLines(report),
		"",
		"Breakdown:",
		...getVisibleCategories(report).map((category) => formatCategoryLine(category, report.maxInputTokens)),
	];

	const warning = getWarningText(report);
	if (warning) {
		lines.push("", warning);
	}

	lines.push("", "Notes:", `- ${report.note}`);
	return lines.join("\n");
}

export function formatTokenUsageSummary(report: TokenUsageReport): string {
	return `OAIProxy token usage: ${formatTokenCount(report.inputTokens)} input (${report.inputUsagePercent.toFixed(1)}% input budget, ${report.contextUsagePercent.toFixed(1)}% context).`;
}

function createTokenUsageCategories(): TokenUsageCategory[] {
	return [
		{ id: "systemContext", label: "System / Project Context", tokens: 0 },
		{ id: "currentPrompt", label: "Current User Prompt", tokens: 0 },
		{ id: "conversationHistory", label: "Conversation History", tokens: 0 },
		{ id: "toolDefinitions", label: "Tool Definitions", tokens: 0 },
		{ id: "toolTraffic", label: "Tool Calls / Results", tokens: 0 },
		{ id: "media", label: "Images / Binary", tokens: 0 },
		{ id: "reasoning", label: "Reasoning History", tokens: 0 },
	];
}

function addMessageDetailsToCategories(
	categories: TokenUsageCategory[],
	message: LanguageModelChatRequestMessage,
	messageIndex: number,
	currentUserMessageIndex: number,
	details: MessageTokenDetails
): void {
	const role = mapRole(message);
	const toolTrafficTokens = details.toolCallTokens + details.toolResultTokens;
	const mediaTokens = details.imageTokens + details.binaryTokens;
	const envelopeTokens = details.overheadTokens + details.textTokens;

	addCategoryTokens(categories, "toolTraffic", toolTrafficTokens);
	addCategoryTokens(categories, "media", mediaTokens);
	addCategoryTokens(categories, "reasoning", details.reasoningTokens);

	if (envelopeTokens <= 0) {
		return;
	}

	if (role === "system") {
		addCategoryTokens(categories, "systemContext", envelopeTokens);
	} else if (role === "user" && messageIndex === currentUserMessageIndex) {
		addCategoryTokens(categories, "currentPrompt", envelopeTokens);
	} else if (toolTrafficTokens > 0 && details.textTokens === 0) {
		addCategoryTokens(categories, "toolTraffic", envelopeTokens);
	} else {
		addCategoryTokens(categories, "conversationHistory", envelopeTokens);
	}
}

function addCategoryTokens(categories: TokenUsageCategory[], id: TokenUsageCategoryId, tokens: number): void {
	const category = categories.find((entry) => entry.id === id);
	if (!category) {
		return;
	}
	category.tokens += tokens;
}

function findCurrentUserPromptIndex(messages: readonly LanguageModelChatRequestMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (mapRole(message) === "user" && hasDirectPromptContent(message)) {
			return index;
		}
	}

	for (let index = messages.length - 1; index >= 0; index--) {
		if (mapRole(messages[index]) === "user") {
			return index;
		}
	}

	return -1;
}

function hasDirectPromptContent(message: LanguageModelChatRequestMessage): boolean {
	for (const part of message.content ?? []) {
		if (part instanceof vscode.LanguageModelTextPart && part.value.trim()) {
			return true;
		}
		if (part instanceof vscode.LanguageModelDataPart && part.mimeType !== "cache_control") {
			return true;
		}
		if (isToolResultPart(part)) {
			continue;
		}
	}
	return false;
}

function getVisibleCategories(report: TokenUsageReport): TokenUsageCategory[] {
	return report.categories.filter((category) => CORE_CATEGORY_IDS.has(category.id) || category.tokens > 0);
}

function formatCategoryLine(category: TokenUsageCategory, maxInputTokens: number): string {
	return `  - ${category.label}: ${formatTokenCount(category.tokens)} (${formatTokenPercentage(category.tokens, maxInputTokens)})`;
}

function formatTooltipCategoryLabel(category: TokenUsageCategory): string {
	switch (category.id) {
		case "systemContext":
			return "$(project) System / Project Context";
		case "currentPrompt":
			return "$(account) User Prompt";
		case "conversationHistory":
			return "$(comment-discussion) Conversation";
		case "toolDefinitions":
			return "$(code) Tool Definitions";
		case "toolTraffic":
			return "$(tools) Tool Calls / Results";
		case "media":
			return "$(file-media) Images / Binary";
		case "reasoning":
			return "$(sparkle) Reasoning";
	}
}

function formatTooltipBreakdownLines(report: TokenUsageReport): string[] {
	const visibleCategories = getVisibleCategories(report);
	if (visibleCategories.length === 0) {
		return ["$(circle-slash) No request tokens counted yet"];
	}

	const lines: string[] = [];

	for (let index = 0; index < visibleCategories.length; index += 2) {
		const first = visibleCategories[index];
		const second = visibleCategories[index + 1];
		const formatted = [first, second]
			.filter((category): category is TokenUsageCategory => Boolean(category))
			.map((category) => `${formatTooltipCategoryLabel(category)} **${formatTokenCount(category.tokens)}**`)
			.join(" · ");
		lines.push(formatted);
	}

	return lines;
}

function formatCacheUsageLines(report: TokenUsageReport): string[] {
	const cacheUsage = getLatestCacheUsage(report.modelId) ?? getLatestCacheUsage();
	if (!cacheUsage) {
		return ["Cache:", "  - Status: no provider cache telemetry yet"];
	}

	const source = cacheUsage.modelId === report.modelId
		? cacheUsage.apiMode
		: `${cacheUsage.apiMode} / ${cacheUsage.modelId}`;
	const lines = [
		"Cache:",
		`  - Status: ${formatCacheStatus(cacheUsage)}`,
		`  - Source: ${source}`,
	];

	if (cacheUsage.cacheHitRate !== undefined) {
		lines.push(
			`  - Hit Rate: ${(cacheUsage.cacheHitRate * 100).toFixed(1)}% (${formatTokenCount(cacheUsage.cacheHitTokens ?? 0)} / ${formatTokenCount(cacheUsage.cacheEligibleTokens ?? 0)} input tokens)`
		);
	} else if (cacheUsage.cacheHitTokens !== undefined) {
		lines.push(`  - Cached Input: ${formatTokenCount(cacheUsage.cacheHitTokens)}`);
	}

	return lines;
}

function formatCacheUsageSummary(cacheUsage: CacheUsageRecord | undefined, report: TokenUsageReport): string {
	if (!cacheUsage) {
		return "$(database) **Cache** No provider telemetry yet";
	}

	const status = formatCacheStatus(cacheUsage);
	const source = cacheUsage.modelId === report.modelId
		? cacheUsage.apiMode
		: `${cacheUsage.apiMode} / ${cacheUsage.modelId}`;
	if (cacheUsage.cacheHitRate !== undefined) {
		return `$(database) **Cache** **${(cacheUsage.cacheHitRate * 100).toFixed(1)}% hit** · ${status} · ${formatTokenCount(cacheUsage.cacheHitTokens ?? 0)} / ${formatTokenCount(cacheUsage.cacheEligibleTokens ?? 0)} · ${source}`;
	}
	if (cacheUsage.cacheHitTokens !== undefined) {
		return `$(database) **Cache** ${formatTokenCount(cacheUsage.cacheHitTokens)} cached input · ${status} · ${source}`;
	}
	return `$(database) **Cache** ${status} · ${source}`;
}

function formatCacheStatus(cacheUsage: CacheUsageRecord): string {
	if (cacheUsage.status === "hit") {
		return "working";
	}
	if (cacheUsage.status === "miss") {
		return "no hit yet";
	}
	return "provider reported";
}

function getWarningText(report: TokenUsageReport): string | undefined {
	if (report.status === "error") {
		return `Warning: input estimate is high (${report.inputUsagePercent.toFixed(1)}% of the advertised input budget).`;
	}
	if (report.status === "warning") {
		return `Warning: input estimate is elevated (${report.inputUsagePercent.toFixed(1)}% of the advertised input budget).`;
	}
	return undefined;
}

function getTokenUsageStatus(inputUsagePercent: number): TokenUsageStatus {
	if (inputUsagePercent >= 90) {
		return "error";
	}
	if (inputUsagePercent >= 70) {
		return "warning";
	}
	return "ok";
}

function calculatePercentage(value: number, maxTokens: number): number {
	if (maxTokens <= 0) {
		return 0;
	}
	return (value / maxTokens) * 100;
}

import * as vscode from "vscode";
import { LanguageModelChatInformation, LanguageModelChatRequestMessage, LanguageModelChatTool } from "vscode";
import { onDidChangeCacheUsage } from "./cacheUsage";
import {
	createProgressBar,
	createTokenUsageReport,
	formatTokenUsageTooltip,
	type TokenUsageReport,
} from "./tokenUsage";

export { createProgressBar, formatTokenCount } from "./tokenUsage";

let latestTokenUsageReport: TokenUsageReport | undefined;

export function initStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
	// Create status bar item for token count display
	const tokenCountStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	tokenCountStatusBarItem.name = "OAIProxy Usage";
	tokenCountStatusBarItem.text = "OAIProxy Ready";
	tokenCountStatusBarItem.tooltip = "Current model token usage - Click to Open Configuration UI";
	tokenCountStatusBarItem.command = "oaiproxy.openConfig";
	context.subscriptions.push(tokenCountStatusBarItem);
	context.subscriptions.push(
		onDidChangeCacheUsage(() => {
			if (latestTokenUsageReport) {
				tokenCountStatusBarItem.tooltip = formatTokenUsageTooltip(latestTokenUsageReport);
			}
		})
	);
	// Show the status bar item initially
	tokenCountStatusBarItem.show();
	return tokenCountStatusBarItem;
}

export function getLatestTokenUsageReport(): TokenUsageReport | undefined {
	return latestTokenUsageReport;
}

/**
 * Update the status bar with token usage information
 * @param messages The chat messages to count tokens for
 * @param tools Optional tool definitions to count tokens for
 * @param model The language model information
 * @param statusBarItem The status bar item to update
 * @param modelConfig Configuration including reasoning settings
 */
export async function updateContextStatusBar(
	messages: readonly LanguageModelChatRequestMessage[],
	tools: readonly LanguageModelChatTool[] | undefined,
	model: LanguageModelChatInformation,
	statusBarItem: vscode.StatusBarItem,
	modelConfig: { includeReasoningInRequest: boolean }
): Promise<void> {
	const report = await createTokenUsageReport({
		messages,
		tools,
		model,
		modelConfig,
	});
	latestTokenUsageReport = report;

	// Keep the status bar compact; detailed usage lives in the hover.
	const progressBar = createProgressBar(report.inputTokens, report.maxContextTokens);
	const displayText = `$(copilot) ${progressBar}`;
	statusBarItem.text = displayText;
	statusBarItem.tooltip = formatTokenUsageTooltip(report);

	// Add color coding based on advertised input budget usage
	const usagePercentage = report.inputUsagePercent;
	if (usagePercentage >= 90) {
		statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
	} else if (usagePercentage >= 70) {
		statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
	} else {
		statusBarItem.backgroundColor = undefined;
	}

	statusBarItem.show();
}

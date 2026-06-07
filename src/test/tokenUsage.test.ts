import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { recordCacheUsage, resetCacheUsageForTests } from "../cacheUsage";
import { countMessageTokenDetails, type MessageTokenDetails } from "../provideToken";
import { TokenizerManager } from "../tokenizer/tokenizerManager";
import {
	createProgressBar,
	createTokenUsageReport,
	formatTokenUsageDetails,
	formatTokenUsageTooltip,
	type TokenUsageEstimator,
} from "../tokenUsage";

const SYSTEM_ROLE = 0 as vscode.LanguageModelChatMessageRole;

suite("tokenUsage", () => {
	teardown(() => {
		resetCacheUsageForTests();
	});

	test("classifies system, current prompt, conversation, tool, media, and reasoning tokens", async () => {
		const messages = [
			message(SYSTEM_ROLE, [new vscode.LanguageModelTextPart("system")]),
			message(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart("previous prompt")]),
			message(vscode.LanguageModelChatMessageRole.Assistant, [
				new vscode.LanguageModelToolCallPart("call_1", "read_file", { path: "src/provider.ts" }),
			]),
			message(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelTextPart("current prompt"),
				new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "application/octet-stream"),
			]),
			message(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart("call_1", [new vscode.LanguageModelTextPart("tool result")]),
			]),
		];
		const details = new WeakMap<object, MessageTokenDetails>([
			[messages[0] as object, tokenDetails({ overheadTokens: 4, textTokens: 16 })],
			[messages[1] as object, tokenDetails({ overheadTokens: 4, textTokens: 20 })],
			[messages[2] as object, tokenDetails({ overheadTokens: 4, toolCallTokens: 30, reasoningTokens: 15 })],
			[messages[3] as object, tokenDetails({ overheadTokens: 4, textTokens: 40, binaryTokens: 80 })],
			[messages[4] as object, tokenDetails({ overheadTokens: 4, toolResultTokens: 50 })],
		]);
		const estimator: TokenUsageEstimator = {
			countMessageDetails: async (msg) => details.get(msg as object) ?? tokenDetails({}),
			countToolDefinitions: async () => 200,
		};

		const report = await createTokenUsageReport(
			{
				messages,
				tools: [
					{ name: "read_file", description: "Read a file", inputSchema: {} } as vscode.LanguageModelChatTool,
					{ name: "edit_file", description: "Edit a file", inputSchema: {} } as vscode.LanguageModelChatTool,
				],
				model: {
					id: "test-model",
					name: "Test Model",
					maxInputTokens: 1000,
					maxOutputTokens: 200,
				} as vscode.LanguageModelChatInformation,
				modelConfig: { includeReasoningInRequest: true },
			},
			estimator
		);

		assert.strictEqual(report.currentUserMessageIndex, 3);
		assert.strictEqual(report.messageTokens, 271);
		assert.strictEqual(report.toolDefinitionTokens, 200);
		assert.strictEqual(report.inputTokens, 471);
		assertCategory(report, "systemContext", 20);
		assertCategory(report, "currentPrompt", 44);
		assertCategory(report, "conversationHistory", 24);
		assertCategory(report, "toolDefinitions", 200);
		assertCategory(report, "toolTraffic", 88);
		assertCategory(report, "media", 80);
		assertCategory(report, "reasoning", 15);
		assert.strictEqual(report.categories.reduce((sum, category) => sum + category.tokens, 0), report.inputTokens);

		const tooltip = formatTokenUsageTooltip(report).value;
		assert.ok(tooltip.includes("$(list-tree) **Breakdown**"));
		assert.ok(tooltip.includes("$(project) System / Project Context **20**"));
		assert.ok(tooltip.includes("$(account) User Prompt **44**"));
		assert.ok(tooltip.includes("$(comment-discussion) Conversation **24**"));
		assert.ok(tooltip.includes("$(code) Tool Definitions **200**"));
		assert.ok(tooltip.includes("$(tools) Tool Calls / Results **88**"));
		assert.ok(tooltip.includes("$(file-media) Images / Binary **80**"));
		assert.ok(tooltip.includes("$(sparkle) Reasoning **15**"));
		assert.ok(!tooltip.includes("Other **"));
	});

	test("formats detailed token usage for hover and command output", async () => {
		recordCacheUsage("openai", "format-model", {
			inputTokens: 1000,
			cachedTokens: 250,
		});
		const report = await createTokenUsageReport(
			{
				messages: [
					message(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart("hello")]),
				],
				tools: [],
				model: {
					id: "format-model",
					name: "Format Model",
					maxInputTokens: 100,
					maxOutputTokens: 50,
				} as vscode.LanguageModelChatInformation,
				modelConfig: { includeReasoningInRequest: false },
			},
			{
				countMessageDetails: async () => tokenDetails({ overheadTokens: 4, textTokens: 91 }),
				countToolDefinitions: async () => 0,
			}
		);

		const tooltip = formatTokenUsageTooltip(report).value;
		const details = formatTokenUsageDetails(report);

		assert.ok(tooltip.includes("$(server-process) **OAIProxy**"));
		assert.ok(!tooltip.includes("<img"));
		assert.ok(tooltip.includes("**63.3%** of context used"));
		assert.ok(tooltip.includes("$(graph-line) **Input budget** 95.0%"));
		assert.ok(tooltip.includes("$(database) **Cache** **25.0% hit** · working"));
		assert.ok(tooltip.includes("User Prompt **95**"));
		assert.ok(!tooltip.includes("| Metric |"));
		assert.ok(!tooltip.includes("████"));
		assert.ok(!tooltip.includes("best-effort estimates"));
		assert.ok(tooltip.includes("Click to open OAIProxy Configuration"));
		assert.ok(details.includes("OAIProxy Token Usage"));
		assert.ok(details.includes("Context Window: 95 / 150 (63.3%)"));
		assert.ok(details.includes("Warning: input estimate is high"));
		assert.strictEqual(createProgressBar(150, 100), "150.0%");
	});

	test("counts message details by part type", async () => {
		TokenizerManager.setExtensionPath(path.resolve(__dirname, "../.."));
		const messageWithParts = message(vscode.LanguageModelChatMessageRole.User, [
			new vscode.LanguageModelTextPart("Read this file."),
			new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "application/octet-stream"),
			new vscode.LanguageModelToolCallPart("call_1", "read_file", { path: "README.md" }),
			new vscode.LanguageModelToolResultPart("call_1", [new vscode.LanguageModelTextPart("file content")]),
		]);

		const details = await countMessageTokenDetails(messageWithParts, { includeReasoningInRequest: false });

		assert.ok(details.overheadTokens > 0);
		assert.ok(details.textTokens > 0);
		assert.ok(details.binaryTokens > 0);
		assert.ok(details.toolCallTokens > 0);
		assert.ok(details.toolResultTokens > 0);
		assert.strictEqual(
			details.totalTokens,
			details.overheadTokens +
				details.textTokens +
				details.imageTokens +
				details.binaryTokens +
				details.toolCallTokens +
				details.toolResultTokens +
				details.reasoningTokens
		);
	});
});

function message(
	role: vscode.LanguageModelChatMessageRole,
	content: vscode.LanguageModelChatRequestMessage["content"]
): vscode.LanguageModelChatRequestMessage {
	return {
		role,
		name: undefined,
		content,
	} as vscode.LanguageModelChatRequestMessage;
}

function tokenDetails(overrides: Partial<MessageTokenDetails>): MessageTokenDetails {
	const details = {
		totalTokens: 0,
		overheadTokens: 0,
		textTokens: 0,
		imageTokens: 0,
		binaryTokens: 0,
		toolCallTokens: 0,
		toolResultTokens: 0,
		reasoningTokens: 0,
		...overrides,
	};
	details.totalTokens = details.overheadTokens +
		details.textTokens +
		details.imageTokens +
		details.binaryTokens +
		details.toolCallTokens +
		details.toolResultTokens +
		details.reasoningTokens;
	return details;
}

function assertCategory(
	report: { categories: Array<{ id: string; tokens: number }> },
	id: string,
	tokens: number
): void {
	const category = report.categories.find((entry) => entry.id === id);
	assert.ok(category, `missing category ${id}`);
	assert.strictEqual(category.tokens, tokens);
}

import * as vscode from "vscode";
import { LanguageModelChatRequestMessage, LanguageModelChatTool } from "vscode";
import { tokenizerManager } from "./tokenizer/tokenizerManager";
import { getImageDimensions } from "./tokenizer/imageUtils";
import { createDataUrl, isToolResultPart } from "./utils";
import { getLanguageModelThinkingText, isLanguageModelThinkingPart } from "./vscodeCompat";
import { logger } from "./logger";

/*
 * Each message comes with 3 tokens per message due to special characters
 */
export const BaseTokensPerMessage = 3;
/*
 * Each name costs 1 token
 */
export const BaseTokensPerName = 1;

export interface MessageTokenDetails {
	totalTokens: number;
	overheadTokens: number;
	textTokens: number;
	imageTokens: number;
	binaryTokens: number;
	toolCallTokens: number;
	toolResultTokens: number;
	reasoningTokens: number;
}

export async function countMessageTokens(
	text: string | LanguageModelChatRequestMessage,
	modelConfig: { includeReasoningInRequest: boolean }
): Promise<number> {
	return (await countMessageTokenDetails(text, modelConfig)).totalTokens;
}

export async function countMessageTokenDetails(
	text: string | LanguageModelChatRequestMessage,
	modelConfig: { includeReasoningInRequest: boolean }
): Promise<MessageTokenDetails> {
	if (typeof text === "string") {
		const textTokens = await textTokenLength(text);
		return {
			...emptyMessageTokenDetails(),
			totalTokens: textTokens,
			textTokens,
		};
	}

	// For complex messages, calculate tokens for each part separately
	const details = emptyMessageTokenDetails();
	details.overheadTokens = BaseTokensPerMessage + BaseTokensPerName;

	for (const part of text.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			// Estimate tokens directly for plain text
			details.textTokens += await textTokenLength(part.value);
		} else if (part instanceof vscode.LanguageModelDataPart) {
			// Estimate tokens for image or data parts based on type
			if (part.mimeType.startsWith("image/")) {
				details.imageTokens += calculateImageTokenCost(createDataUrl(part));
			} else if (part.mimeType === "cache_control") {
				/* ignore */
			} else {
				// For other binary data, use a more conservative estimate
				details.binaryTokens += calculateNonImageBinaryTokens(part.data.byteLength);
			}
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			// Tool call token calculation
			details.toolCallTokens += BaseTokensPerName;
			details.toolCallTokens += await textTokenLength(JSON.stringify(part.input));
		} else if (isToolResultPart(part)) {
			// Tool result token calculation
			details.toolResultTokens += await textTokenLength(JSON.stringify(part.content));
		} else if (isLanguageModelThinkingPart(part)) {
			// Thinking Token
			if (modelConfig.includeReasoningInRequest) {
				details.reasoningTokens += await textTokenLength(getLanguageModelThinkingText(part));
			}
		} else {
			console.warn(`Unknown part type: ${JSON.stringify(part)}`);
		}
	}

	details.totalTokens = sumMessageTokenDetails(details);
	return details;
}

export async function textTokenLength(text: string): Promise<number> {
	try {
		return tokenizerManager.countTokens(text);
	} catch (err) {
		logger.debug("tokenizer.error", {
			errorMessage: err instanceof Error ? err.message : String(err),
			textLength: text.length,
		});
		return Math.ceil(text.length / 4);
	}
}

export async function countToolTokens(tools: readonly LanguageModelChatTool[]): Promise<number> {
	const baseToolTokens = 16;
	let numTokens = 0;
	if (tools.length) {
		numTokens += baseToolTokens;
	}

	const baseTokensPerTool = 8;
	for (const tool of tools) {
		numTokens += baseTokensPerTool;
		numTokens += await textTokenLength(JSON.stringify(tool));
	}

	return numTokens;
}

// https://platform.openai.com/docs/guides/vision#calculating-costs
function calculateImageTokenCost(imageUrl: string): number {
	let { width, height } = getImageDimensions(imageUrl);

	if (width <= 0 || height <= 0) {
		return 0;
	}

	// Scale image to fit within a 2048 x 2048 square if necessary.
	if (width > 2048 || height > 2048) {
		const scaleFactor = 2048 / Math.max(width, height);
		width = Math.round(width * scaleFactor);
		height = Math.round(height * scaleFactor);
	}

	const scaleFactor = 768 / Math.min(width, height);
	width = Math.round(width * scaleFactor);
	height = Math.round(height * scaleFactor);

	const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);

	return tiles * 170 + 85;
}

function calculateNonImageBinaryTokens(byteLength: number): number {
	if (!byteLength) {
		return 0;
	}
	const base = 20;
	const per16Kb = Math.ceil(byteLength / 16384);
	return Math.min(200, base + per16Kb);
}

function emptyMessageTokenDetails(): MessageTokenDetails {
	return {
		totalTokens: 0,
		overheadTokens: 0,
		textTokens: 0,
		imageTokens: 0,
		binaryTokens: 0,
		toolCallTokens: 0,
		toolResultTokens: 0,
		reasoningTokens: 0,
	};
}

function sumMessageTokenDetails(details: MessageTokenDetails): number {
	return details.overheadTokens +
		details.textTokens +
		details.imageTokens +
		details.binaryTokens +
		details.toolCallTokens +
		details.toolResultTokens +
		details.reasoningTokens;
}

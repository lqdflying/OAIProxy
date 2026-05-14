import * as vscode from "vscode";
import * as crypto from "crypto";
import { isImageMimeType, normalizeUserModels } from "./utils";
import { logger } from "./logger";

const CACHE_MAX_ENTRIES = 50;
const CACHE_MAX_SIZE_BYTES = 512_000; // ~500KB of description text

const VISION_PROMPT =
	"Describe this image in detail for use as context in a coding conversation. " +
	"Focus on any text, code, diagrams, UI elements, or technical content visible in the image.";

const LANGUAGE_MODEL_VENDOR = "oaiproxy";

// ---------------------------------------------------------------------------
// In-memory LRU cache for image descriptions
// ---------------------------------------------------------------------------

class ImageDescriptionCache {
	private cache = new Map<string, string>();
	private currentSizeBytes = 0;

	get(key: string): string | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			this.cache.delete(key);
			this.cache.set(key, value);
		}
		return value;
	}

	set(key: string, value: string): void {
		const entrySize = (key.length + value.length) * 2;

		const existing = this.cache.get(key);
		if (existing !== undefined) {
			this.currentSizeBytes -= (key.length + existing.length) * 2;
			this.cache.delete(key);
		}

		while (
			(this.cache.size >= CACHE_MAX_ENTRIES || this.currentSizeBytes + entrySize > CACHE_MAX_SIZE_BYTES) &&
			this.cache.size > 0
		) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey === undefined) {
				break;
			}
			const firstValue = this.cache.get(firstKey)!;
			this.currentSizeBytes -= (firstKey.length + firstValue.length) * 2;
			this.cache.delete(firstKey);
		}

		this.cache.set(key, value);
		this.currentSizeBytes += entrySize;
	}
}

const descriptionCache = new ImageDescriptionCache();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashImageData(data: Uint8Array): string {
	return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Check whether any message in the array contains an image data part.
 */
export function messagesContainImages(messages: readonly vscode.LanguageModelChatRequestMessage[]): boolean {
	for (const m of messages) {
		for (const part of m.content ?? []) {
			if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
				return true;
			}
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Vision model discovery
// ---------------------------------------------------------------------------

async function findVisionModel(excludeModelId: string): Promise<vscode.LanguageModelChat> {
	const config = vscode.workspace.getConfiguration();
	const userModels = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));

	const visionModelConfigs = userModels.filter((m) => m.vision === true && m.id !== excludeModelId);

	if (visionModelConfigs.length === 0) {
		throw new Error(
			"No vision-capable model configured. " +
				'Add a model with "vision": true to oaicopilot.models to use images with text-only models.'
		);
	}

	const availableModels = await vscode.lm.selectChatModels({ vendor: LANGUAGE_MODEL_VENDOR });

	for (const vmc of visionModelConfigs) {
		const fullId = vmc.configId ? `${vmc.id}::${vmc.configId}` : vmc.id;
		const chatModel = availableModels.find((m) => m.id === fullId || m.id === vmc.id);
		if (chatModel) {
			return chatModel;
		}
	}

	throw new Error(
		"Vision model configured but not available. " +
			'Ensure a model with "vision": true is properly registered.'
	);
}

// ---------------------------------------------------------------------------
// Single-image description (with cache)
// ---------------------------------------------------------------------------

async function describeImage(
	imagePart: vscode.LanguageModelDataPart,
	visionModel: vscode.LanguageModelChat,
	token: vscode.CancellationToken
): Promise<string> {
	const cacheKey = hashImageData(imagePart.data);

	const cached = descriptionCache.get(cacheKey);
	if (cached !== undefined) {
		logger.debug("visionBridge.cache.hit", { cacheKey: cacheKey.substring(0, 16) });
		return cached;
	}

	logger.info("visionBridge.describe", {
		mimeType: imagePart.mimeType,
		dataSize: imagePart.data.byteLength,
		visionModel: visionModel.id,
	});

	// Use LanguageModelChatMessage2 (proposed API) for DataPart support,
	// falling back to the standard LanguageModelChatMessage.
	const ChatMessageCtor: typeof vscode.LanguageModelChatMessage =
		(vscode as Record<string, unknown>).LanguageModelChatMessage2 as typeof vscode.LanguageModelChatMessage ??
		vscode.LanguageModelChatMessage;

	const messages = [
		ChatMessageCtor.User([new vscode.LanguageModelTextPart(VISION_PROMPT), imagePart] as never),
	];

	const response = await visionModel.sendRequest(messages as never[], {}, token);
	let description = "";
	for await (const chunk of response.text) {
		if (token.isCancellationRequested) {
			throw new Error("Vision bridge request cancelled");
		}
		description += chunk;
	}

	description = description.trim();
	if (!description) {
		throw new Error("Vision model returned empty description");
	}

	descriptionCache.set(cacheKey, description);
	logger.debug("visionBridge.cache.store", {
		cacheKey: cacheKey.substring(0, 16),
		descriptionLength: description.length,
	});

	return description;
}

// ---------------------------------------------------------------------------
// Public API — rewrite messages that contain images
// ---------------------------------------------------------------------------

/**
 * Scan messages for image parts and replace them with text descriptions
 * obtained from a vision-capable model. Non-image parts are kept as-is.
 */
export async function processMessagesForVision(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	targetModelId: string,
	token: vscode.CancellationToken
): Promise<vscode.LanguageModelChatRequestMessage[]> {
	const visionModel = await findVisionModel(targetModelId);

	logger.info("visionBridge.processing", {
		targetModel: targetModelId,
		visionModel: visionModel.id,
		messageCount: messages.length,
	});

	let convertedCount = 0;
	const result: vscode.LanguageModelChatRequestMessage[] = [];

	for (const message of messages) {
		const content = message.content ?? [];
		let hasImages = false;

		for (const part of content) {
			if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
				hasImages = true;
				break;
			}
		}

		if (!hasImages) {
			result.push(message);
			continue;
		}

		const newContent: unknown[] = [];

		for (const part of content) {
			if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
				const description = await describeImage(part, visionModel, token);
				newContent.push(new vscode.LanguageModelTextPart(`[Image description: ${description}]`));
				convertedCount++;
			} else {
				newContent.push(part);
			}
		}

		// Build a replacement message preserving role and name.
		const replaced = {
			role: message.role,
			content: newContent,
			name: (message as { name?: string }).name,
		} as vscode.LanguageModelChatRequestMessage;
		result.push(replaced);
	}

	logger.info("visionBridge.complete", { convertedImages: convertedCount });
	return result;
}

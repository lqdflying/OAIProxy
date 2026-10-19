import { prepareMessagesForApi, encodeImageData, isImageDataPart, type ContentOptions } from "../messageContent";
import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatRequestMessage,
	ProvideLanguageModelChatResponseOptions,
	LanguageModelResponsePart2,
	Progress,
} from "vscode";

import type { HFModelItem } from "../types";

import type {
	AnthropicMessage,
	AnthropicRequestBody,
	AnthropicContentBlock,
	AnthropicTextBlock,
	AnthropicImageBlock,
	AnthropicToolUseBlock,
	AnthropicToolResultBlock,
	AnthropicStreamChunk,
} from "./anthropicTypes";

import {
	isImageMimeType,
	isVideoMimeType,
	isToolResultPart,
	collectToolResultText,
	convertToolsToOpenAI,
	mapRole,
} from "../utils";

import { CommonApi } from "../commonApi";
import { logger } from "../logger";
import {
	createLanguageModelThinkingPart,
	getLanguageModelThinkingId,
	getLanguageModelThinkingMetadata,
	getLanguageModelThinkingText,
	isLanguageModelThinkingPart,
} from "../vscodeCompat";
import { isAnthropicAdaptiveThinkingModel, normalizeReasoningEffortForModel } from "../reasoningEffort";
import { ResponseUsageAccumulator } from "../responseUsage";
import { createProviderStreamError } from "../streamUtils";
import {
	applyCacheControl,
	createAnthropicCacheControl,
	isCacheControlPart,
	logCacheUsage,
	parseCacheControlPart,
	shouldCacheAnthropicSystem,
	shouldCacheAnthropicTools,
	type AnthropicCacheControl,
} from "../promptCache";

function normalizeAnthropicThinkingType(value: string | undefined): "enabled" | "adaptive" | "disabled" | undefined {
	if (value === "enabled" || value === "adaptive" || value === "disabled") {
		return value;
	}
	return undefined;
}

export function resolveAnthropicThinkingType(
	um: HFModelItem | undefined
): "enabled" | "adaptive" | "disabled" | undefined {
	const configured = normalizeAnthropicThinkingType(um?.thinking?.type);
	if (configured) {
		return configured;
	}
	const effort = um ? normalizeReasoningEffortForModel(um, um.reasoning_effort) : undefined;
	if (effort && um && isAnthropicAdaptiveThinkingModel(um) && um.enable_thinking !== false) {
		return "adaptive";
	}
	if (um?.enable_thinking === true) {
		return isAnthropicAdaptiveThinkingModel(um) && um.thinking_budget === undefined ? "adaptive" : "enabled";
	}
	return undefined;
}

export function isAnthropicManualThinkingEnabled(um: HFModelItem | undefined): boolean {
	return resolveAnthropicThinkingType(um) === "enabled";
}

export class AnthropicApi extends CommonApi<AnthropicMessage, AnthropicRequestBody> {
	private _systemBlocks: AnthropicTextBlock[] | undefined;
	private readonly _thinkingBlocksByIndex = new Map<number, { signature?: string; redacted?: string }>();

	constructor(modelId: string) {
		super(modelId);
	}

	/**
	 * Convert VS Code chat messages to Anthropic message format.
	 * @param messages The VS Code chat messages to convert.
	 * @param modelConfig model configuration that may affect message conversion.
	 * @returns Anthropic-compatible messages array.
	 */
	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean } & ContentOptions,
		model?: HFModelItem
	): AnthropicMessage[] {
		messages = prepareMessagesForApi(messages, { ...modelConfig, apiMode: "anthropic" });
		const replayThinking = modelConfig.includeReasoningInRequest || isAnthropicManualThinkingEnabled(model);
		const out: AnthropicMessage[] = [];

		for (const m of messages) {
			const role = mapRole(m);
			const textParts: string[] = [];
			const imageParts: vscode.LanguageModelDataPart[] = [];
			const videoParts: vscode.LanguageModelDataPart[] = [];
			const toolCalls: AnthropicToolUseBlock[] = [];
			const toolResults: AnthropicToolResultBlock[] = [];
			const thinkingBlocks: AnthropicContentBlock[] = [];
			let pendingThinking: { id?: string; text: string; signature?: string } | undefined;
			const closePendingThinking = () => {
				if (!pendingThinking) {
					return;
				}
				if (pendingThinking.signature) {
					thinkingBlocks.push({
						type: "thinking",
						thinking: pendingThinking.text,
						signature: pendingThinking.signature,
					});
				} else if (pendingThinking.text) {
					// Replaying a thinking block without its provider signature is
					// invalid, so drop it instead of fabricating one.
					logger.debug("anthropic.thinking.replaySkipped", { reason: "missing signature" });
				}
				pendingThinking = undefined;
			};
			let cacheControl: AnthropicCacheControl | null = null;

			for (const part of m.content ?? []) {
				if (part instanceof vscode.LanguageModelTextPart) {
					textParts.push(part.value);
				} else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
					imageParts.push(part);
				} else if (part instanceof vscode.LanguageModelDataPart && isVideoMimeType(part.mimeType)) {
					videoParts.push(part);
				} else if (isCacheControlPart(part)) {
					cacheControl = parseCacheControlPart(part);
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					const id = part.callId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
					toolCalls.push({
						type: "tool_use",
						id,
						name: part.name,
						input: (part.input as Record<string, unknown>) ?? {},
					});
				} else if (isToolResultPart(part)) {
					const callId = (part as { callId?: string }).callId ?? "";
					const parts = (part.content ?? []).map((item): AnthropicTextBlock | AnthropicImageBlock =>
						isImageDataPart(item)
							? { type: "image", source: { type: "base64", media_type: item.mimeType, data: encodeImageData(item, modelConfig) } }
							: { type: "text", text: collectToolResultText({ content: [item] }) }
					);
					const content = parts.some((item) => item.type === "image") ? parts : parts.map((item) => item.type === "text" ? item.text : "").join("");
					toolResults.push({
						type: "tool_result",
						tool_use_id: callId,
						content,
					});
				} else if (isLanguageModelThinkingPart(part)) {
					const metadata = getLanguageModelThinkingMetadata(part);
					const redactedThinking = metadata?.redactedThinking;
					if (typeof redactedThinking === "string" && redactedThinking) {
						closePendingThinking();
						thinkingBlocks.push({ type: "redacted_thinking", data: redactedThinking });
						continue;
					}

					const text = getLanguageModelThinkingText(part);
					const id = getLanguageModelThinkingId(part);
					const signature = typeof metadata?.signature === "string" ? metadata.signature : undefined;
					const sameBlock = pendingThinking && ((id && pendingThinking.id === id) || (!id && !pendingThinking.id));
					if (!sameBlock) {
						closePendingThinking();
						pendingThinking = { id, text, signature };
					} else if (pendingThinking) {
						pendingThinking.text += text;
						pendingThinking.signature = signature ?? pendingThinking.signature;
					}
				}
			}

			closePendingThinking();

			const joinedText = textParts.join("").trim();

			// Handle system messages separately (Anthropic uses top-level system field)
			if (role === "system") {
				if (joinedText) {
					if (cacheControl) {
						const systemBlock: AnthropicTextBlock = {
							type: "text",
							text: joinedText,
						};
						this._systemBlocks = [
							applyCacheControl(
								systemBlock as unknown as Record<string, unknown>,
								cacheControl
							) as unknown as AnthropicTextBlock,
						];
						this._systemContent = undefined;
					} else {
						this._systemContent = joinedText;
						this._systemBlocks = undefined;
					}
				}
				continue;
			}

			// Build content blocks for user/assistant messages
			const contentBlocks: AnthropicContentBlock[] = [];

			// Replay signed thinking blocks verbatim and before the rest of the
			// assistant turn, as required by Anthropic extended thinking.
			if (role === "assistant" && replayThinking) {
				contentBlocks.push(...thinkingBlocks);
			}

			// Add text content
			if (joinedText) {
				contentBlocks.push({
					type: "text",
					text: joinedText,
				});
			}

			// Add image content
			for (const imagePart of imageParts) {
				const base64Data = encodeImageData(imagePart, modelConfig);
				contentBlocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: imagePart.mimeType,
						data: base64Data,
					},
				});
			}

			// Add video content
			for (const videoPart of videoParts) {
				const base64Data = Buffer.from(videoPart.data).toString("base64");
				contentBlocks.push({
					type: "video",
					source: {
						type: "base64",
						media_type: videoPart.mimeType,
						data: base64Data,
					},
				});
			}

			// Add tool calls for assistant messages
			for (const toolCall of toolCalls) {
				contentBlocks.push(toolCall);
			}

			// For tool results, they should be added to user messages
			// We'll add them to the current message if it's a user message
			if (role === "user" && toolResults.length > 0) {
				contentBlocks.unshift(...toolResults);
			} else if (toolResults.length > 0) {
				// If tool results appear in non-user messages, log warning
				console.warn("[Anthropic Provider] Tool results found in non-user message, ignoring");
				logger.warn("anthropic.tool-results.non-user", {
					messageRole: role,
					toolResultCount: toolResults.length,
				});
			}

			if (cacheControl && contentBlocks.length > 0) {
				applyCacheControl(contentBlocks[contentBlocks.length - 1] as unknown as Record<string, unknown>, cacheControl);
			}

			// Only add message if we have content blocks
			if (contentBlocks.length > 0) {
				out.push({
					role,
					content: contentBlocks,
				});
			}
		}

		return out;
	}

	prepareRequestBody(
		rb: AnthropicRequestBody,
		um: HFModelItem | undefined,
		options?: ProvideLanguageModelChatResponseOptions
	): AnthropicRequestBody {
		// max_tokens is required for Anthropic API
		rb.max_tokens = um?.max_completion_tokens ?? um?.max_tokens ?? rb.max_tokens ?? 4096;

		// Add system content if we extracted it
		if (this._systemBlocks) {
			rb.system = this._systemBlocks;
		} else if (this._systemContent) {
			rb.system = this._systemContent;
		}
		if (shouldCacheAnthropicSystem(um) && rb.system) {
			rb.system = this.applySystemCacheControl(rb.system, createAnthropicCacheControl(um));
		}

		// Add temperature
		if (um?.temperature !== undefined && um.temperature !== null) {
			rb.temperature = um.temperature;
		}

		// Add top_p if configured
		if (um?.top_p !== undefined && um.top_p !== null) {
			rb.top_p = um.top_p;
		}

		// Add top_k if configured
		if (um?.top_k !== undefined) {
			rb.top_k = um.top_k;
		}

		const configuredThinkingType = resolveAnthropicThinkingType(um);
		if (configuredThinkingType) {
			rb.thinking =
				configuredThinkingType === "enabled"
					? { type: "enabled", budget_tokens: um?.thinking_budget ?? 1024 }
					: { type: configuredThinkingType };
		}

		const effort = um ? normalizeReasoningEffortForModel(um, um.reasoning_effort) : undefined;
		if (effort) {
			rb.output_config = {
				...rb.output_config,
				effort,
			};

			if (um && isAnthropicAdaptiveThinkingModel(um) && !rb.thinking && um.enable_thinking !== false) {
				rb.thinking = { type: "adaptive" };
			}
		}

		if (um?.enable_thinking === true && !rb.thinking) {
			if (isAnthropicAdaptiveThinkingModel(um) && um.thinking_budget === undefined) {
				rb.thinking = { type: "adaptive" };
			} else {
				rb.thinking = {
					type: "enabled",
					budget_tokens: um.thinking_budget ?? 1024,
				};
			}
		}

		// Add tools configuration
		const toolConfig = convertToolsToOpenAI(options);
		if (toolConfig.tools) {
			// Convert OpenAI tool definitions to Anthropic format
			rb.tools = toolConfig.tools.map((tool) => ({
				name: tool.function.name,
				description: tool.function.description,
				input_schema: tool.function.parameters,
			}));
		}

		// Add tool_choice
		if (toolConfig.tool_choice) {
			if (toolConfig.tool_choice === "auto") {
				rb.tool_choice = { type: "auto" };
			} else if (typeof toolConfig.tool_choice === "object" && toolConfig.tool_choice.type === "function") {
				rb.tool_choice = { type: "tool", name: toolConfig.tool_choice.function.name };
			}
		}

		// Process extra configuration parameters
		if (um?.extra && typeof um.extra === "object") {
			// Add all extra parameters directly to the request body
			for (const [key, value] of Object.entries(um.extra)) {
				if (value !== undefined) {
					if (key === "tools" && Array.isArray(value) && rb.tools) {
						rb.tools = [...rb.tools, ...value];
					} else {
						(rb as unknown as Record<string, unknown>)[key] = value;
					}
				}
			}
		}

		if (shouldCacheAnthropicTools(um) && rb.tools && rb.tools.length > 0) {
			applyCacheControl(
				rb.tools[rb.tools.length - 1] as unknown as Record<string, unknown>,
				createAnthropicCacheControl(um)
			);
		}

		// Anthropic requires an enabled thinking budget of at least 1024 tokens and
		// strictly below max_tokens. Reject invalid manual configurations locally
		// instead of relying on a remote 400.
		if (rb.thinking?.type === "enabled") {
			const budget = rb.thinking.budget_tokens;
			if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 1024) {
				throw new Error(
					`Invalid Anthropic thinking_budget: ${String(budget)}. When thinking is enabled the budget must be at least 1024 tokens.`
				);
			}
			if (typeof rb.max_tokens === "number" && budget >= rb.max_tokens) {
				throw new Error(
					`Invalid Anthropic thinking_budget: ${budget} must be smaller than max_tokens (${rb.max_tokens}).`
				);
			}
		}

		return rb;
	}

	private applySystemCacheControl(
		system: string | AnthropicTextBlock[],
		cacheControl: AnthropicCacheControl
	): string | AnthropicTextBlock[] {
		if (typeof system === "string") {
			const systemBlock: AnthropicTextBlock = {
				type: "text",
				text: system,
			};
			return [
				applyCacheControl(
					systemBlock as unknown as Record<string, unknown>,
					cacheControl
				) as unknown as AnthropicTextBlock,
			];
		}

		if (system.length === 0) {
			return system;
		}

		applyCacheControl(system[system.length - 1] as unknown as Record<string, unknown>, cacheControl);
		return system;
	}

	/**
	 * Process Anthropic streaming response (SSE format).
	 * @param responseBody The readable stream body.
	 * @param progress Progress reporter for streamed parts.
	 * @param token Cancellation token.
	 */
	async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const modelId = this._modelId;
		logger.debug("anthropic.stream.start", { modelId });

		const reader = responseBody.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const responseUsage = new ResponseUsageAccumulator("anthropic");
		let completed = false;
		let sawProviderError = false;
		let providerErrorMessage: string | undefined;

		const handleLine = async (line: string): Promise<void> => {
			if (line.trim() === "") {
				return;
			}
			if (!line.startsWith("data:")) {
				return;
			}

			const data = line.slice(5).trim();
			logger.debug("anthropic.stream.chunk", { modelId, data });
			if (data === "[DONE]") {
				// Do not throw on [DONE]; any incomplete/empty buffers are ignored.
				await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
				return;
			}

			try {
				const chunk: AnthropicStreamChunk = JSON.parse(data);
				responseUsage.record(chunk);
				this.observeResponseCompletion(chunk);
				if (chunk.type === "error") {
					sawProviderError = true;
					providerErrorMessage = [chunk.error?.type, chunk.error?.message]
						.filter((value): value is string => !!value)
						.join(": ") || providerErrorMessage;
				}
				await this.processAnthropicChunk(chunk, progress);
			} catch (e) {
				console.error("[Anthropic Provider] Failed to parse SSE chunk:", e, "data:", data);
				logger.error("anthropic.stream.chunk.error", {
					modelId,
					error: e instanceof Error ? e.message : String(e),
					data,
				});
			}
		};

		try {
			while (true) {
				if (token.isCancellationRequested) {
					break;
				}

				const { done, value } = await reader.read();
				if (value?.byteLength) { this.observeStreamChunk(); }
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					await handleLine(line);
				}
			}
			buffer += decoder.decode();
			if (buffer.length > 0) {
				for (const line of buffer.split("\n")) {
					await handleLine(line);
				}
				buffer = "";
			}
			if (sawProviderError && !token.isCancellationRequested) {
				throw createProviderStreamError("Anthropic", providerErrorMessage);
			}
			completed = !token.isCancellationRequested && !sawProviderError;
			logger.debug("anthropic.stream.done", { modelId });
		} catch (e) {
			console.error("[Anthropic Provider] Streaming response error:", e);
			logger.error("anthropic.stream.error", { modelId, error: e instanceof Error ? e.message : String(e) });
			throw e;
		} finally {
			reader.releaseLock();
			// If there's an active thinking sequence, end it first
			this.reportEndThinking(progress);
			if (completed) {
				const usagePart = responseUsage.toDataPart();
				if (usagePart) {
					progress.report(usagePart);
				}
			}
		}
	}

	/**
	 * Process a single Anthropic streaming chunk.
	 * @param chunk Parsed Anthropic stream chunk.
	 * @param progress Progress reporter for parts.
	 */
	private async processAnthropicChunk(
		chunk: AnthropicStreamChunk,
		progress: Progress<LanguageModelResponsePart2>
	): Promise<void> {
		logCacheUsage("anthropic", this._modelId, chunk);

		// Handle ping events (ignore)
		if (chunk.type === "ping") {
			return;
		}

		// Handle error events
		if (chunk.type === "error") {
			const errorType = chunk.error?.type || "unknown_error";
			const errorMessage = chunk.error?.message || "Anthropic API streaming error";
			console.error(`[Anthropic Provider] Streaming error: ${errorType} - ${errorMessage}`);
			// We could throw here, but for now just log and continue
			return;
		}

		if (chunk.type === "message_start" && chunk.message) {
			// Extract message metadata (id, model, etc.)
			// Could store for later use, but not required for basic streaming
			return;
		}

		if (chunk.type === "message_delta" && chunk.delta) {
			// Usage is accumulated by the stream reader; this branch handles message metadata only.
			return;
		}

		if (chunk.type === "content_block_start" && chunk.content_block) {
			// Start of a content block
			if (chunk.content_block.type === "thinking") {
				const idx = (chunk.index as number) ?? 0;
				this._thinkingBlocksByIndex.set(idx, {});
				// Each thinking block gets its own part id so the signature can be
				// associated with exactly this block after it closes.
				this._currentThinkingId = this.generateThinkingId();
				// Start thinking block
				if (chunk.content_block.thinking) {
					this.bufferThinkingContent(chunk.content_block.thinking, progress);
				}
			} else if (chunk.content_block.type === "redacted_thinking") {
				const idx = (chunk.index as number) ?? 0;
				this._thinkingBlocksByIndex.set(idx, { redacted: chunk.content_block.data ?? "" });
			} else if (chunk.content_block.type === "tool_use") {
				// Start tool call block
				// SSEProcessor-like: if first tool call appears after text, emit a whitespace
				// to ensure any UI buffers/linkifiers are flushed without adding visible noise.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
					progress.report(new vscode.LanguageModelTextPart(" "));
					this._emittedBeginToolCallsHint = true;
				}
				const idx = (chunk.index as number) ?? 0;
				this._toolCallBuffers.set(idx, {
					id: chunk.content_block.id,
					name: chunk.content_block.name,
					args: "",
				});
			} else if (chunk.content_block.type === "text") {
				// Text block start - nothing special to do
				// The text content will come via content_block_delta events
			}
		} else if (chunk.type === "content_block_delta" && chunk.delta) {
			if (chunk.delta.type === "text_delta" && chunk.delta.text) {
				// Emit text content
				progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
				this._hasEmittedAssistantText = true;
			} else if (chunk.delta.type === "thinking_delta" && chunk.delta.thinking) {
				// Buffer thinking content
				this.bufferThinkingContent(chunk.delta.thinking, progress);
			} else if (chunk.delta.type === "input_json_delta" && chunk.delta.partial_json) {
				// Handle tool call argument streaming
				// Find the latest tool call buffer and append partial JSON
				const idx = (chunk.index as number) ?? 0;
				const buf = this._toolCallBuffers.get(idx);
				if (buf) {
					buf.args += chunk.delta.partial_json;
					this._toolCallBuffers.set(idx, buf);
					// Try to emit if we have valid JSON
					await this.tryEmitBufferedToolCall(idx, progress);
				}
			} else if (chunk.delta.type === "signature_delta" && chunk.delta.signature) {
				const idx = (chunk.index as number) ?? 0;
				const block = this._thinkingBlocksByIndex.get(idx);
				if (block) {
					block.signature = chunk.delta.signature;
				}
			}
		} else if (chunk.type === "content_block_stop" || chunk.type === "message_stop") {
			const idx = (chunk.index as number) ?? 0;
			const thinkingBlock = this._thinkingBlocksByIndex.get(idx);
			if (thinkingBlock) {
				if (thinkingBlock.redacted) {
					progress.report(
						createLanguageModelThinkingPart("", this._currentThinkingId ?? this.generateThinkingId(), {
							redactedThinking: thinkingBlock.redacted,
						})
					);
				} else {
					this.flushThinkingBuffer(progress);
					if (thinkingBlock.signature && this._currentThinkingId) {
						progress.report(
							createLanguageModelThinkingPart("", this._currentThinkingId, {
								signature: thinkingBlock.signature,
							})
						);
					}
				}
				this._thinkingBlocksByIndex.delete(idx);
			}
			// End of message - ensure thinking is ended and flush all tool calls
			await this.flushToolCallBuffers(progress, false);
			this.reportEndThinking(progress);
		}
	}

	async *createMessage(
		model: HFModelItem,
		systemPrompt: string,
		messages: { role: string; content: string }[],
		baseUrl: string,
		apiKey: string,
		signal?: AbortSignal
	): AsyncGenerator<{ type: "text"; text: string }> {
		// For Anthropic, we need to separate system prompt from messages
		const anthropicMessages: AnthropicMessage[] = messages.map((m) => ({
			role: m.role === "user" || m.role === "assistant" ? m.role : "user",
			content: m.content,
		}));
		this._systemContent = systemPrompt;

		// requestBody
		let requestBody: AnthropicRequestBody = {
			model: model.id,
			messages: anthropicMessages,
			stream: true,
		};
		requestBody = this.prepareRequestBody(requestBody, model, undefined);

		const headers = CommonApi.prepareHeaders(apiKey, model.apiMode ?? "anthropic", model.headers);

		const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
		// Some providers require configuring the baseUrl with a version suffix (e.g. .../v1).
		// Avoid double-appending (e.g. .../v1/v1/messages).
		const url = normalizedBaseUrl.endsWith("/v1")
			? `${normalizedBaseUrl}/messages`
			: `${normalizedBaseUrl}/v1/messages`;

		// Make the API request
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Anthropic API request failed: [${response.status}] ${response.statusText}\n${errorText}`);
		}

		if (!response.body) {
			throw new Error("No response body from Anthropic API");
		}

		// Process the response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		const handleLine = async function* (line: string): AsyncGenerator<{ type: "text"; text: string }> {
			if (line.trim() === "") {
				return;
			}
			if (!line.startsWith("data:")) {
				return;
			}

			const data = line.slice(5).trim();
			if (data === "[DONE]") {
				return;
			}

			try {
				const chunk: AnthropicStreamChunk = JSON.parse(data);

				// Anthropic streaming response
				if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta" && chunk.delta?.text) {
					yield { type: "text", text: chunk.delta.text };
				}

				// Handle error responses
				if (chunk.type === "error") {
					const errorType = chunk.error?.type || "unknown_error";
					const errorMessage = chunk.error?.message || "Anthropic API streaming error";
					console.error(`[Anthropic Provider] Streaming error: ${errorType} - ${errorMessage}`);
				}
			} catch (e) {
				console.error("[Anthropic Provider] Failed to parse SSE chunk:", e, "data:", data);
			}
		};

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					yield* handleLine(line);
				}
			}
			buffer += decoder.decode();
			if (buffer.length > 0) {
				for (const line of buffer.split("\n")) {
					yield* handleLine(line);
				}
				buffer = "";
			}
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}
}

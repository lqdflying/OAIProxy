import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatProvider,
	LanguageModelChatRequestMessage,
	ProvideLanguageModelChatResponseOptions,
	LanguageModelResponsePart2,
	Progress,
} from "vscode";

import type { HFModelItem } from "./types";

import type { OllamaRequestBody } from "./ollama/ollamaTypes";

import {
	parseModelId,
	createRetryConfig,
	executeWithRetry,
	normalizeUserModels,
	getStringConfiguration,
	isImageMimeType,
} from "./utils";
import { messagesContainImages, processMessagesForVision, VISION_BRIDGE_REQUEST_OPTION } from "./visionBridge";

import { prepareLanguageModelChatInformation } from "./provideModel";
import { countMessageTokens } from "./provideToken";
import { updateContextStatusBar } from "./statusBar";
import { OllamaApi } from "./ollama/ollamaApi";
import { OpenaiApi } from "./openai/openaiApi";
import { OpenaiResponsesApi } from "./openai/openaiResponsesApi";
import { OpenAIResponsesStateStore } from "./openai/openaiResponsesState";
import { AnthropicApi } from "./anthropic/anthropicApi";
import { AnthropicRequestBody } from "./anthropic/anthropicTypes";
import { GeminiApi, buildGeminiGenerateContentUrl, type GeminiToolCallMeta } from "./gemini/geminiApi";
import type { GeminiGenerateContentRequest } from "./gemini/geminiTypes";
import { CommonApi } from "./commonApi";
import { logger } from "./logger";
import { normalizeReasoningEffortForModel } from "./reasoningEffort";
import { applyOpenAIPromptCache } from "./promptCache";

interface ChatInformationOptions {
	readonly silent?: boolean;
	readonly configuration?: Readonly<Record<string, unknown>>;
}

/**
 * VS Code Chat provider backed by Hugging Face Inference Providers.
 */
export class HuggingFaceChatModelProvider implements LanguageModelChatProvider, vscode.Disposable {
	/** Track last outbound API attempt time for delay calculation. */
	private _lastRequestTime: number | null = null;

	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	private readonly _geminiToolCallMetaByCallId = new Map<string, GeminiToolCallMeta>();
	private readonly _openaiResponsesPreviousResponseIdUnsupportedBaseUrls = new Set<string>();
	private readonly _openaiResponsesState = new OpenAIResponsesStateStore();

	static readonly OPENAI_RESPONSES_STATEFUL_MARKER_MIME = "application/vnd.oaiproxy.stateful-marker";

	/**
	 * Create a provider using the given secret storage for the API key.
	 * @param secrets VS Code secret storage.
	 */
	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly statusBarItem: vscode.StatusBarItem
	) {}

	refreshLanguageModelChatInformation(): void {
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	dispose(): void {
		this._onDidChangeLanguageModelChatInformation.dispose();
	}

	/**
	 * Get the list of available language models contributed by this provider
	 * @param options Options which specify the calling context of this function
	 * @param token A cancellation token which signals if the user cancelled the request or not
	 * @returns A promise that resolves to the list of available language models
	 */
	async provideLanguageModelChatInformation(
		options: ChatInformationOptions,
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const silent = options.silent ?? true;
		return prepareLanguageModelChatInformation({ silent, configuration: options.configuration }, _token, this.secrets);
	}

	/**
	 * Returns the number of tokens for a given text using the model specific tokenizer logic
	 * @param model The language model to use
	 * @param text The text to count tokens for
	 * @param token A cancellation token for the request
	 * @returns A promise that resolves to the number of tokens
	 */
	async provideTokenCount(
		_model: LanguageModelChatInformation,
		text: string | LanguageModelChatRequestMessage,
		_token: CancellationToken
	): Promise<number> {
		return countMessageTokens(text, { includeReasoningInRequest: true });
	}

	/**
	 * Returns the response for a chat request, passing the results to the progress callback.
	 * The {@linkcode LanguageModelChatProvider} must emit the response parts to the progress callback as they are received from the language model.
	 * @param model The language model to use
	 * @param messages The messages to include in the request
	 * @param options Options for the request
	 * @param progress The progress to emit the streamed response chunks to
	 * @param token A cancellation token for the request
	 * @returns A promise that resolves when the response is complete. Results are actually passed to the progress callback.
	 */
	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const trackingProgress: Progress<LanguageModelResponsePart2> = {
			report: (part) => {
				try {
					progress.report(part);
				} catch (e) {
					console.error("[OAIProxy Model Provider] Progress.report failed", {
						modelId: model.id,
						error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
					});
				}
			},
		};
		const requestStartTime = Date.now();
		const abortController = new AbortController();
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());
		if (token.isCancellationRequested) {
			abortController.abort();
		}
		try {
			// get model config from user settings
			const config = vscode.workspace.getConfiguration();
			const userModels = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));

			// Parse model ID to handle config ID
			const parsedModelId = parseModelId(model.id);

			// Find matching user model configuration
			// Prioritize matching models with same base ID and config ID
			// If no config ID, match models with same base ID
			let um: HFModelItem | undefined = userModels.find(
				(um) =>
					um.id === parsedModelId.baseId &&
					((parsedModelId.configId && um.configId === parsedModelId.configId) ||
						(!parsedModelId.configId && !um.configId))
			);

			// If still no model found, try to find any model matching the base ID (most lenient match, for backward compatibility)
			if (!um) {
				um = userModels.find((um) => um.id === parsedModelId.baseId);
			}
			um = applyModelConfiguration(um, options.modelConfiguration);

			// Check if using Ollama native API mode
			const apiMode = um?.apiMode ?? "openai";
			const baseUrl = um?.baseUrl || config.get<string>("oaicopilot.baseUrl", "");

			logger.info("request.start", {
				modelId: model.id,
				messageCount: messages.length,
				apiMode,
				baseUrl,
			});

			// Prepare model configuration
			const modelConfig = {
				includeReasoningInRequest: um?.include_reasoning_in_request ?? false,
			};

			// Update Token Usage
			updateContextStatusBar(messages, options.tools, model, this.statusBarItem, modelConfig);

			// Apply delay between consecutive requests
			const modelDelay = um?.delay;
			const globalDelay = config.get<number>("oaicopilot.delay", 0);
			const delayMs = modelDelay !== undefined ? modelDelay : globalDelay;

			if (delayMs > 0 && this._lastRequestTime !== null) {
				const elapsed = Date.now() - this._lastRequestTime;
				if (elapsed < delayMs) {
					const remainingDelay = delayMs - elapsed;
					logger.debug("request.delay", {
						delayMs,
						elapsed,
						remainingDelay,
					});
					await waitForDelayOrCancellation(remainingDelay, token);
					if (token.isCancellationRequested) {
						return;
					}
				}
			}

			// Get API key for the model's provider
			const provider = um?.owned_by;
			const useGenericKey = !um?.baseUrl;
			const modelApiKey = await this.ensureApiKey(useGenericKey, provider, baseUrl, apiMode);
			if (!modelApiKey) {
				logger.warn("apiKey.missing", {
					provider: provider ?? "",
					useGenericKey,
				});
				throw new Error("OAIProxy API key not found");
			}

			// send chat request
			const BASE_URL = baseUrl;
			if (!BASE_URL) {
				throw new Error(`Invalid base URL configuration: baseUrl is empty.`);
			}
			try {
				const parsed = new URL(BASE_URL);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					throw new Error("protocol must be http or https");
				}
			} catch (e) {
				throw new Error(`Invalid base URL configuration: ${BASE_URL} (${e instanceof Error ? e.message : String(e)})`);
			}

			// get retry config
			const retryConfig = createRetryConfig();
			const isVisionBridgeRequest = options.modelOptions?.[VISION_BRIDGE_REQUEST_OPTION] === true;
			const inputContainsImages = messagesContainImages(messages);

			// prepare headers with custom headers if specified
			const requestHeaders = CommonApi.prepareHeaders(modelApiKey, apiMode, um?.headers);
			logger.debug("request.headers", {
				headers: logger.sanitizeHeaders(requestHeaders as Record<string, string>),
			});
			logRequestMessages(messages, isVisionBridgeRequest);
			if (token.isCancellationRequested) {
				return;
			}

			// Vision bridge: for non-vision models, replace images with text descriptions
			// obtained from a configured vision-capable model.
			let workingMessages: readonly LanguageModelChatRequestMessage[] = messages;
			if (um?.vision === false && inputContainsImages) {
				try {
					workingMessages = await processMessagesForVision(messages, model.id, token);
					if (token.isCancellationRequested) {
						return;
					}
				} catch (err) {
					if (token.isCancellationRequested || isAbortError(err)) {
						return;
					}
					throw new Error(
						`Failed to describe image for text-only model: ${err instanceof Error ? err.message : String(err)}`
					);
				}
			}

			this._lastRequestTime = Date.now();
			if (apiMode === "ollama") {
				// Ollama native API mode
				const ollamaApi = new OllamaApi(model.id);
				const ollamaMessages = ollamaApi.convertMessages(workingMessages, modelConfig);

				let ollamaRequestBody: OllamaRequestBody = {
					model: parsedModelId.baseId,
					messages: ollamaMessages,
					stream: true,
				};
				ollamaRequestBody = ollamaApi.prepareRequestBody(ollamaRequestBody, um, options);

				// send Ollama chat request with retry
				const url = `${BASE_URL.replace(/\/+$/, "")}/api/chat`;
				logRequestBody(url, ollamaRequestBody, isVisionBridgeRequest);
				const response = await executeWithRetry(async () => {
					const res = await fetch(url, {
						method: "POST",
						headers: requestHeaders,
						body: JSON.stringify(ollamaRequestBody),
						signal: abortController.signal,
					});

					if (!res.ok) {
						const errorText = await res.text();
						console.error("[Ollama Provider] Ollama API error response", errorText);
						throw new Error(
							`Ollama API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
						);
					}

					return res;
				}, retryConfig);

				if (!response.body) {
					throw new Error("No response body from Ollama API");
				}
				await ollamaApi.processStreamingResponse(response.body, trackingProgress, token);
			} else if (apiMode === "anthropic") {
				// Anthropic API mode
				const anthropicApi = new AnthropicApi(model.id);
				const anthropicMessages = anthropicApi.convertMessages(workingMessages, modelConfig);

				// requestBody
				let requestBody: AnthropicRequestBody = {
					model: parsedModelId.baseId,
					messages: anthropicMessages,
					stream: true,
				};
				requestBody = anthropicApi.prepareRequestBody(requestBody, um, options);

				// send Anthropic chat request with retry
				const normalizedBaseUrl = BASE_URL.replace(/\/+$/, "");
				// Some providers require configuring the baseUrl with a version suffix (e.g. .../v1).
				// Avoid double-appending (e.g. .../v1/v1/messages).
				const url = normalizedBaseUrl.endsWith("/v1")
					? `${normalizedBaseUrl}/messages`
					: `${normalizedBaseUrl}/v1/messages`;
				logRequestBody(url, requestBody, isVisionBridgeRequest);
				const response = await executeWithRetry(async () => {
					const res = await fetch(url, {
						method: "POST",
						headers: requestHeaders,
						body: JSON.stringify(requestBody),
						signal: abortController.signal,
					});

					if (!res.ok) {
						const errorText = await res.text();
						console.error("[Anthropic Provider] Anthropic API error response", errorText);
						throw new Error(
							`Anthropic API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
						);
					}

					return res;
				}, retryConfig);

				if (!response.body) {
					throw new Error("No response body from Anthropic API");
				}
				await anthropicApi.processStreamingResponse(response.body, trackingProgress, token);
			} else if (apiMode === "openai-responses") {
				// OpenAI Responses API mode
				const openaiResponsesApi = new OpenaiResponsesApi(model.id);
				const normalizedBaseUrl = BASE_URL.replace(/\/+$/, "");
				const statefulModelId = parsedModelId.baseId;

				// Convert full history once (also extracts system `instructions`).
				const fullInput = openaiResponsesApi.convertMessages(workingMessages, modelConfig);

				const marker = findLastOpenAIResponsesStatefulMarker(statefulModelId, workingMessages);
				let markerDeltaInput: unknown[] | null = null;
				if (marker && marker.index >= 0 && marker.index < workingMessages.length - 1) {
					const deltaMessages = workingMessages.slice(marker.index + 1);
					const converted = openaiResponsesApi.convertMessages(deltaMessages, modelConfig);
					if (converted.length > 0) {
						markerDeltaInput = converted;
					}
				}

				let preparedFullRequestBody: Record<string, unknown> = {
					model: parsedModelId.baseId,
					input: fullInput,
					stream: true,
				};
				preparedFullRequestBody = openaiResponsesApi.prepareRequestBody(preparedFullRequestBody, um, options);

				const previousResponseIdUnsupported = this._openaiResponsesPreviousResponseIdUnsupportedBaseUrls.has(normalizedBaseUrl);
				const explicitPreviousResponseId = preparedFullRequestBody.previous_response_id !== undefined;
				const memoryState = this._openaiResponsesState.resolve({
					identity: {
						normalizedBaseUrl,
						modelId: statefulModelId,
						modelInfoId: model.id,
						configId: parsedModelId.configId,
						requestInitiator: options.requestInitiator,
						instructions: preparedFullRequestBody.instructions,
						tools: preparedFullRequestBody.tools,
						toolChoice: preparedFullRequestBody.tool_choice,
					},
					fullInput,
					previousResponseIdUnsupported,
				});

				const canUseMarkerPreviousResponseId =
					!!marker?.marker &&
					!previousResponseIdUnsupported &&
					Array.isArray(markerDeltaInput) &&
					markerDeltaInput.length > 0;
				const canUseMemoryPreviousResponseId =
					!marker?.marker &&
					!previousResponseIdUnsupported &&
					!!memoryState.responseId &&
					Array.isArray(memoryState.deltaInput) &&
					memoryState.deltaInput.length > 0;
				const canUsePreviousResponseId =
					!explicitPreviousResponseId && (canUseMarkerPreviousResponseId || canUseMemoryPreviousResponseId);
				let stateSource: "marker" | "memory" | "none" = "none";
				let previousResponseId: string | undefined;
				let input: unknown[] = fullInput;
				if (!explicitPreviousResponseId && canUseMarkerPreviousResponseId) {
					stateSource = "marker";
					previousResponseId = marker!.marker;
					input = markerDeltaInput!;
				} else if (!explicitPreviousResponseId && canUseMemoryPreviousResponseId) {
					stateSource = "memory";
					previousResponseId = memoryState.responseId;
					input = memoryState.deltaInput!;
				}

				const statefulMetadata = {
					hasStatefulMarker: !!marker?.marker,
					markerMessageIndex: marker?.index,
					fullInputCount: fullInput.length,
					markerDeltaInputCount: markerDeltaInput?.length,
					deltaInputCount: input.length,
					stateSource,
					memoryStateFound: memoryState.memoryStateFound,
					memoryStateExpired: memoryState.memoryStateExpired,
					memoryPrefixMatched: memoryState.memoryPrefixMatched,
					previousInputCount: memoryState.previousInputCount,
					currentInputCount: memoryState.currentInputCount,
					memoryDeltaInputCount: memoryState.memoryDeltaInputCount,
					memorySkippedAssistantInputCount: memoryState.memorySkippedAssistantInputCount,
					previousResponseIdUnsupported,
				};

				// requestBody
				let requestBody: Record<string, unknown> = {
					...preparedFullRequestBody,
					input,
				};

				applyOpenAIPromptCache(requestBody, {
					model: um,
					baseUrl: BASE_URL,
					modelId: parsedModelId.baseId,
				});
				// send Responses API request with retry
				const url = `${normalizedBaseUrl}/responses`;

				// If the user explicitly set `previous_response_id` via `extra`, don't apply stateful slicing.
				let addedPreviousResponseId = false;
				if (requestBody.previous_response_id !== undefined) {
					requestBody.input = fullInput;
				} else if (previousResponseId) {
					requestBody.previous_response_id = previousResponseId;
					addedPreviousResponseId = true;
				}
				let finalStateSource = stateSource;
				let previousResponseIdFallback = false;
				logRequestBody(url, requestBody, isVisionBridgeRequest, {
					...statefulMetadata,
					canUsePreviousResponseId,
					addedPreviousResponseId,
					explicitPreviousResponseId,
					usedStatefulDeltaInput: addedPreviousResponseId,
				});

				const sendRequest = async (body: Record<string, unknown>) =>
					await executeWithRetry(async () => {
						const res = await fetch(url, {
							method: "POST",
							headers: requestHeaders,
							body: JSON.stringify(body),
							signal: abortController.signal,
						});

						if (!res.ok) {
							const errorText = await res.text();
							const error = new Error(
								`Responses API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
							);
							(error as { status?: number; errorText?: string }).status = res.status;
							(error as { status?: number; errorText?: string }).errorText = errorText;
							throw error;
						}

						return res;
					}, retryConfig);

				let response: Response;
				try {
					response = await sendRequest(requestBody);
				} catch (err) {
					// Some Responses-compatible gateways don't support `previous_response_id`.
					// Fall back to sending full history when the previous-response attempt fails.
					const status = (err as { status?: unknown })?.status;
					const shouldFallback =
						addedPreviousResponseId && typeof status === "number" && status >= 400 && status < 500 && status !== 429;
					if (!shouldFallback) {
						throw err;
					}

					this._openaiResponsesPreviousResponseIdUnsupportedBaseUrls.add(normalizedBaseUrl);

					let fallbackBody: Record<string, unknown> = {
						model: parsedModelId.baseId,
						input: fullInput,
						stream: true,
					};
					fallbackBody = openaiResponsesApi.prepareRequestBody(fallbackBody, um, options);
					applyOpenAIPromptCache(fallbackBody, {
						model: um,
						baseUrl: BASE_URL,
						modelId: parsedModelId.baseId,
					});
					delete fallbackBody.previous_response_id;
					logRequestBody(url, fallbackBody, isVisionBridgeRequest, {
						...statefulMetadata,
						canUsePreviousResponseId: false,
						addedPreviousResponseId: false,
						explicitPreviousResponseId,
						usedStatefulDeltaInput: false,
						stateSource: "none",
						attemptedStateSource: stateSource,
						previousResponseIdUnsupported: true,
						previousResponseIdFallback: true,
					});
					response = await sendRequest(fallbackBody);
					this._openaiResponsesState.clear(memoryState.stateKey);
					requestBody = fallbackBody;
					addedPreviousResponseId = false;
					finalStateSource = "none";
					previousResponseIdFallback = true;
				}

				if (!response.body) {
					throw new Error("No response body from Responses API");
				}
				await openaiResponsesApi.processStreamingResponse(response.body, trackingProgress, token);

				// Append a stateful marker so future requests can reuse `previous_response_id` (Copilot Chat style).
				const responseId = openaiResponsesApi.responseId;
				const memoryStateStored = !!responseId && !explicitPreviousResponseId && !previousResponseIdFallback &&
					!this._openaiResponsesPreviousResponseIdUnsupportedBaseUrls.has(normalizedBaseUrl) &&
					this._openaiResponsesState.update({
						stateKey: memoryState.stateKey,
						responseId,
						inputSignatures: memoryState.inputSignatures,
					});
				logger.debug("responses.state", {
					modelId: model.id,
					responseIdCaptured: !!responseId,
					statefulMarkerEmitted: !!responseId,
					addedPreviousResponseId,
					explicitPreviousResponseId,
					usedStatefulDeltaInput: addedPreviousResponseId,
					stateSource: finalStateSource,
					previousResponseIdFallback,
					memoryStateStored,
					stateEntryCount: this._openaiResponsesState.size,
					fullInputCount: fullInput.length,
					requestInputCount: getArrayLength(requestBody.input),
				});
				if (responseId) {
					trackingProgress.report(createOpenAIResponsesStatefulMarkerPart(statefulModelId, responseId));
				}
			} else if (apiMode === "gemini") {
				// Gemini native API mode
				const geminiApi = new GeminiApi(model.id, this._geminiToolCallMetaByCallId);
				const geminiMessages = geminiApi.convertMessages(workingMessages, modelConfig);

				const systemParts: string[] = [];
				const contents: GeminiGenerateContentRequest["contents"] = [];
				for (const msg of geminiMessages) {
					if (msg.role === "system") {
						const text = msg.parts
							.map((p) =>
								p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
									? String((p as { text: string }).text)
									: ""
							)
							.join("")
							.trim();
						if (text) {
							systemParts.push(text);
						}
						continue;
					}
					contents.push({ role: msg.role, parts: msg.parts });
				}

				let requestBody: GeminiGenerateContentRequest = {
					contents,
				};
				if (systemParts.length > 0) {
					requestBody.systemInstruction = { role: "user", parts: [{ text: systemParts.join("\n") }] };
				}
				requestBody = geminiApi.prepareRequestBody(requestBody, um, options);

				const url = buildGeminiGenerateContentUrl(BASE_URL, parsedModelId.baseId, true);
				logRequestBody(url, requestBody, isVisionBridgeRequest);
				if (!url) {
					throw new Error("Invalid Gemini base URL configuration.");
				}

				const response = await executeWithRetry(async () => {
					const res = await fetch(url, {
						method: "POST",
						headers: requestHeaders,
						body: JSON.stringify(requestBody),
						signal: abortController.signal,
					});

					if (!res.ok) {
						const errorText = await res.text();
						console.error("[Gemini Provider] Gemini API error response", errorText);
						throw new Error(
							`Gemini API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
						);
					}

					return res;
				}, retryConfig);

				if (!response.body) {
					throw new Error("No response body from Gemini API");
				}
				await geminiApi.processStreamingResponse(response.body, trackingProgress, token);
			} else {
				// OpenAI compatible API mode (default)
				const openaiApi = new OpenaiApi(model.id);
				const openaiMessages = openaiApi.convertMessages(workingMessages, modelConfig);

				// requestBody
				let requestBody: Record<string, unknown> = {
					model: parsedModelId.baseId,
					messages: openaiMessages,
					stream: true,
					stream_options: { include_usage: true },
				};
				requestBody = openaiApi.prepareRequestBody(requestBody, um, options);
				applyOpenAIPromptCache(requestBody, {
					model: um,
					baseUrl: BASE_URL,
					modelId: parsedModelId.baseId,
				});

				// send chat request with retry
				const url = `${BASE_URL.replace(/\/+$/, "")}/chat/completions`;
				logRequestBody(url, requestBody, isVisionBridgeRequest);
				const response = await executeWithRetry(async () => {
					const res = await fetch(url, {
						method: "POST",
						headers: requestHeaders,
						body: JSON.stringify(requestBody),
						signal: abortController.signal,
					});

					if (!res.ok) {
						const errorText = await res.text();
						console.error("[OAIProxy Model Provider] OAIProxy API error response", errorText);
						throw new Error(
							`OAIProxy API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
						);
					}

					return res;
				}, retryConfig);

				if (!response.body) {
					throw new Error("No response body from OAIProxy API");
				}
				await openaiApi.processStreamingResponse(response.body, trackingProgress, token);
			}
		} catch (err) {
			if (token.isCancellationRequested || isAbortError(err)) {
				logger.info("request.cancelled", { modelId: model.id });
				return;
			}
			console.error("[OAIProxy Model Provider] Chat request failed", {
				modelId: model.id,
				messageCount: messages.length,
				error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
			});
			logger.error("request.error", {
				modelId: model.id,
				messageCount: messages.length,
				errorName: err instanceof Error ? err.name : String(err),
				errorMessage: err instanceof Error ? err.message : String(err),
			});
			throw err;
		} finally {
			cancellationListener.dispose();
			const durationMs = Date.now() - requestStartTime;
			logger.info("request.end", { modelId: model.id, durationMs });
		}
	}

	/**
	 * Ensure an API key exists in SecretStorage, optionally prompting the user when not silent.
	 * @param useGenericKey If true, use generic API key.
	 * @param provider Optional provider name to get provider-specific API key.
	 */
	private async ensureApiKey(
		useGenericKey: boolean,
		provider?: string,
		baseUrl?: string,
		apiMode?: string
	): Promise<string | undefined> {
		let apiKey: string | undefined;
		const normalizedProvider = provider?.trim().toLowerCase();
		const providerKey = normalizedProvider ? `oaicopilot.apiKey.${normalizedProvider}` : undefined;
		const shouldUseProviderKey = !useGenericKey && providerKey !== undefined;

		// 1. Dedicated provider models must use the matching provider key.
		// Falling back to the generic key can accidentally send another provider's credential.
		if (shouldUseProviderKey) {
			apiKey = await this.secrets.get(providerKey);
			apiKey = await this.normalizeStoredApiKey({
				apiKey,
				secretKey: providerKey,
				title: `OAIProxy API Key for ${normalizedProvider}`,
				prompt: `Enter your OAIProxy API key for ${normalizedProvider}`,
				provider: normalizedProvider,
				baseUrl,
				apiMode,
			});
			return apiKey;
		}

		// 2. Generic/global-provider models use the generic key.
		apiKey = await this.secrets.get("oaicopilot.apiKey");
		return await this.normalizeStoredApiKey({
			apiKey,
			secretKey: "oaicopilot.apiKey",
			title: "OAIProxy API Key",
			prompt: "Enter your OAIProxy API key",
			provider: normalizedProvider,
			baseUrl,
			apiMode,
		});
	}

	private async normalizeStoredApiKey(options: {
		apiKey: string | undefined;
		secretKey: string;
		title: string;
		prompt: string;
		provider?: string;
		baseUrl?: string;
		apiMode?: string;
	}): Promise<string | undefined> {
		let apiKey = options.apiKey?.trim();
		if (apiKey && apiKey !== options.apiKey) {
			await this.secrets.store(options.secretKey, apiKey);
		}

		if (apiKey && this.isInvalidOfficialOpenAIApiKey(apiKey, options.provider, options.baseUrl, options.apiMode)) {
			logger.warn("apiKey.invalidShape", {
				provider: options.provider ?? "",
				baseUrl: options.baseUrl ?? "",
				apiMode: options.apiMode ?? "",
				secretKey: options.secretKey,
				keyPrefix: apiKey.slice(0, 4),
				keyLength: apiKey.length,
			});
			await this.secrets.delete(options.secretKey);
			apiKey = undefined;
			void vscode.window.showWarningMessage(
				"Stored OpenAI API key is malformed. OAIProxy removed it; enter a valid OpenAI key starting with sk-."
			);
		}

		if (!apiKey) {
			const entered = await vscode.window.showInputBox({
				title: options.title,
				prompt: options.prompt,
				ignoreFocusOut: true,
				password: true,
			});
			if (entered && entered.trim()) {
				apiKey = entered.trim();
				if (this.isInvalidOfficialOpenAIApiKey(apiKey, options.provider, options.baseUrl, options.apiMode)) {
					throw new Error("Invalid OpenAI API key format. Enter an OpenAI API key that starts with sk-.");
				}
				await this.secrets.store(options.secretKey, apiKey);
			}
		}

		return apiKey;
	}

	private isInvalidOfficialOpenAIApiKey(
		apiKey: string,
		provider?: string,
		baseUrl?: string,
		apiMode?: string
	): boolean {
		if (apiMode !== "openai" && apiMode !== "openai-responses") {
			return false;
		}

		const normalizedProvider = provider?.trim().toLowerCase();
		const isOpenAIProvider = normalizedProvider === "openai";
		const isOpenAIBaseUrl = (() => {
			try {
				return new URL(baseUrl ?? "").hostname.toLowerCase() === "api.openai.com";
			} catch {
				return false;
			}
		})();

		if (!isOpenAIProvider && !isOpenAIBaseUrl) {
			return false;
		}

		return !apiKey.startsWith("sk-");
	}
}

interface OpenAIResponsesStatefulMarkerLocation {
	marker: string;
	index: number;
}

function applyModelConfiguration(
	model: HFModelItem | undefined,
	configuration: ProvideLanguageModelChatResponseOptions["modelConfiguration"] | undefined
): HFModelItem | undefined {
	if (!model || !configuration) {
		return model;
	}

	const reasoningEffort = normalizeReasoningEffortForModel(
		model,
		getStringConfiguration(configuration, "reasoningEffort", "reasoning_effort")
	);
	if (!reasoningEffort) {
		return model;
	}

	const next: HFModelItem = { ...model };
	if (model.reasoning !== undefined && model.reasoning_effort === undefined) {
		next.reasoning = { ...model.reasoning, effort: reasoningEffort };
	} else {
		next.reasoning_effort = reasoningEffort;
	}

	return next;
}

function waitForDelayOrCancellation(delayMs: number, token: CancellationToken): Promise<void> {
	if (delayMs <= 0 || token.isCancellationRequested) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve) => {
		const disposables: vscode.Disposable[] = [];
		const timeout = setTimeout(() => {
			disposables.pop()?.dispose();
			resolve();
		}, delayMs);
		disposables.push(
			token.onCancellationRequested(() => {
				clearTimeout(timeout);
				disposables.pop()?.dispose();
				resolve();
			})
		);
	});
}

function isAbortError(error: unknown): boolean {
	return !!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

function logRequestMessages(
	messages: readonly LanguageModelChatRequestMessage[],
	visionBridge: boolean
): void {
	logger.debug("request.messages.origin", {
		visionBridge,
		...summarizeLanguageModelMessages(messages),
	});
}

function summarizeLanguageModelMessages(messages: readonly LanguageModelChatRequestMessage[]): Record<string, unknown> {
	let textPartCount = 0;
	let textLength = 0;
	let dataPartCount = 0;
	let imagePartCount = 0;
	let imageBytes = 0;
	const imageMimeTypes = new Set<string>();

	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textPartCount++;
				textLength += part.value.length;
			} else if (part instanceof vscode.LanguageModelDataPart) {
				dataPartCount++;
				if (isImageMimeType(part.mimeType)) {
					imagePartCount++;
					imageBytes += part.data.byteLength;
					imageMimeTypes.add(part.mimeType);
				}
			}
		}
	}

	return {
		rawMessagesOmitted: true,
		messageCount: messages.length,
		textPartCount,
		textLength,
		dataPartCount,
		imagePartCount,
		imageBytes,
		imageMimeTypes: Array.from(imageMimeTypes),
	};
}

function logRequestBody(
	url: string | null | undefined,
	requestBody: unknown,
	visionBridge: boolean,
	extraSummary?: Record<string, unknown>
): void {
	logger.debug("request.body", {
		url,
		visionBridge,
		requestBody: {
			...summarizeRequestBody(requestBody),
			...(extraSummary ?? {}),
		},
	});
}

function summarizeRequestBody(requestBody: unknown): Record<string, unknown> {
	const body = requestBody && typeof requestBody === "object"
		? requestBody as Record<string, unknown>
		: {};

	return {
		payloadSummarized: true,
		rawBodyOmitted: true,
		imagePayloadsOmitted: containsImagePayload(requestBody),
		model: typeof body.model === "string" ? body.model : undefined,
		stream: typeof body.stream === "boolean" ? body.stream : undefined,
		messageCount: getArrayLength(body.messages),
		inputCount: getArrayLength(body.input),
		contentCount: getArrayLength(body.contents),
		toolCount: getArrayLength(body.tools),
		hasToolChoice: body.tool_choice !== undefined || body.toolChoice !== undefined,
		hasInstructions: body.instructions !== undefined,
		hasSystemInstruction: body.systemInstruction !== undefined,
		hasPromptCacheKey: body.prompt_cache_key !== undefined,
		promptCacheKeyLength: typeof body.prompt_cache_key === "string" ? body.prompt_cache_key.length : undefined,
		hasPromptCacheRetention: body.prompt_cache_retention !== undefined,
		promptCacheRetention: typeof body.prompt_cache_retention === "string" ? body.prompt_cache_retention : undefined,
		hasPreviousResponseId: body.previous_response_id !== undefined,
		previousResponseIdPrefix: typeof body.previous_response_id === "string"
			? body.previous_response_id.slice(0, 8)
			: undefined,
	};
}

function getArrayLength(value: unknown): number | undefined {
	return Array.isArray(value) ? value.length : undefined;
}

function containsImagePayload(value: unknown, depth = 0): boolean {
	if (depth > 8 || value === undefined || value === null) {
		return false;
	}
	if (typeof value === "string") {
		return value.startsWith("data:image/");
	}
	if (Array.isArray(value)) {
		return value.some((item) => containsImagePayload(item, depth + 1));
	}
	if (typeof value !== "object") {
		return false;
	}

	const obj = value as Record<string, unknown>;
	if (
		typeof obj.type === "string" &&
		["image", "image_url", "input_image"].includes(obj.type)
	) {
		return true;
	}
	if (typeof obj.mime_type === "string" && obj.mime_type.startsWith("image/")) {
		return true;
	}
	if (typeof obj.mimeType === "string" && obj.mimeType.startsWith("image/")) {
		return true;
	}

	return Object.values(obj).some((item) => containsImagePayload(item, depth + 1));
}

function createOpenAIResponsesStatefulMarkerPart(modelId: string, marker: string): vscode.LanguageModelDataPart {
	const payload = `${modelId}\\${marker}`;
	const bytes = new TextEncoder().encode(payload);
	return new vscode.LanguageModelDataPart(bytes, HuggingFaceChatModelProvider.OPENAI_RESPONSES_STATEFUL_MARKER_MIME);
}

function parseOpenAIResponsesStatefulMarkerPart(part: unknown): { modelId: string; marker: string } | null {
	const maybe = part as { mimeType?: unknown; data?: unknown };
	if (!maybe || typeof maybe !== "object") {
		return null;
	}
	if (typeof maybe.mimeType !== "string") {
		return null;
	}
	if (!(maybe.data instanceof Uint8Array)) {
		return null;
	}
	if (maybe.mimeType !== HuggingFaceChatModelProvider.OPENAI_RESPONSES_STATEFUL_MARKER_MIME) {
		return null;
	}

	try {
		const decoded = new TextDecoder().decode(maybe.data);
		const sep = decoded.indexOf("\\");
		if (sep <= 0) {
			return null;
		}
		const modelId = decoded.slice(0, sep).trim();
		const marker = decoded.slice(sep + 1).trim();
		if (!modelId || !marker) {
			return null;
		}
		return { modelId, marker };
	} catch {
		return null;
	}
}

function findLastOpenAIResponsesStatefulMarker(
	modelId: string,
	messages: readonly LanguageModelChatRequestMessage[]
): OpenAIResponsesStatefulMarkerLocation | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}
		for (const part of messages[i].content ?? []) {
			const parsed = parseOpenAIResponsesStatefulMarkerPart(part);
			if (parsed && parsed.modelId === modelId) {
				return { marker: parsed.marker, index: i };
			}
		}
	}
	return null;
}

import * as vscode from "vscode";
import { HuggingFaceChatModelProvider } from "./provider";
import type { HFModelItem } from "./types";
import { initStatusBar } from "./statusBar";
import { ConfigViewPanel } from "./views/configView";
import { logger } from "./logger";
import { getModelProviderId, normalizeUserModels, parseModelId } from "./utils";
import { abortCommitGeneration, generateCommitMsg } from "./gitCommit/commitMessageGenerator";
import { TokenizerManager } from "./tokenizer/tokenizerManager";
import { VersionManager } from "./versionManager";

const LANGUAGE_MODEL_VENDOR = "oaiproxy";
const LAST_ACTIVATED_VERSION_KEY = "oaiproxy.lastActivatedVersion";

export function activate(context: vscode.ExtensionContext) {
	// Initialize logger
	logger.init();
	context.subscriptions.push({ dispose: () => logger.dispose() });
	recordExtensionLifecycle(context);

	// Initialize TokenizerManager with extension path
	TokenizerManager.initialize(context.extensionPath);

	const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
	const chatProvider = new HuggingFaceChatModelProvider(context.secrets, tokenCountStatusBarItem);
	context.subscriptions.push(chatProvider);
	// Register the provider under the vendor id used in package.json.
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(LANGUAGE_MODEL_VENDOR, chatProvider));
	refreshLanguageModels(chatProvider);
	scheduleLanguageModelWarmup(context);

	// Management command to configure API key
	context.subscriptions.push(
		vscode.commands.registerCommand("oaiproxy.setApikey", async (...args: unknown[]) => {
			const config = vscode.workspace.getConfiguration();
			const userModels = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
			const providerFromArgs = getProviderFromCommandArgs(args, userModels);

			if (providerFromArgs) {
				await configureApiKey(context, chatProvider, providerFromArgs);
				return;
			}

			const providerTargets = getProviderKeyTargets(userModels);
			if (providerTargets.length > 0) {
				const selectedTarget = await vscode.window.showQuickPick(
					[
						...providerTargets.map((target) => ({
							label: `$(key) ${target.label}`,
							description: `Provider key: ${target.provider}`,
							provider: target.provider,
						})),
						{
							label: "$(globe) Generic OAIProxy key",
							description: "Used by models without a custom baseUrl",
							provider: undefined,
						},
					],
					{
						title: "Select API Key Scope",
						placeHolder: "Choose which API key to configure",
					}
				);
				if (!selectedTarget) {
					return;
				}
				await configureApiKey(context, chatProvider, selectedTarget.provider);
				return;
			}

			await configureApiKey(context, chatProvider);
		})
	);

	// Management command to configure provider-specific API keys
	context.subscriptions.push(
		vscode.commands.registerCommand("oaiproxy.setProviderApikey", async () => {
			// Get provider list from configuration
			const config = vscode.workspace.getConfiguration();
			const userModels = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
			const providers = getProviderKeyTargets(userModels);

			if (providers.length === 0) {
				vscode.window.showErrorMessage(
					"No provider-specific models found in oaicopilot.models. Configure at least one model with owned_by and baseUrl first."
				);
				return;
			}

			// Let user select provider
			const selectedProvider = await vscode.window.showQuickPick(
				providers.map((target) => ({
					label: target.label,
					description: `Provider key: ${target.provider}`,
					provider: target.provider,
				})),
				{
					title: "Select Provider",
					placeHolder: "Select a provider to configure API key",
				}
			);

			if (!selectedProvider) {
				return; // user canceled
			}

			await configureApiKey(context, chatProvider, selectedProvider.provider);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("oaiproxy.openConfig", async () => {
			ConfigViewPanel.openPanel(context.extensionUri, context.secrets);
		})
	);

	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand("oaiproxy.generateGitCommitMessage", async (scm) => {
			generateCommitMsg(context.secrets, scm);
		}),
		vscode.commands.registerCommand("oaiproxy.abortGitCommitMessage", () => {
			abortCommitGeneration();
		})
	);

	// Watch for logLevel configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("oaicopilot.logLevel")) {
				logger.reloadConfig();
			}
			if (e.affectsConfiguration("oaicopilot.models") || e.affectsConfiguration("oaicopilot.baseUrl")) {
				refreshLanguageModels(chatProvider);
			}
		})
	);
}

export function deactivate() {}

interface ProviderKeyTarget {
	provider: string;
	label: string;
}

async function configureApiKey(
	context: vscode.ExtensionContext,
	provider: HuggingFaceChatModelProvider,
	providerId?: string
): Promise<void> {
	const normalizedProvider = providerId?.trim().toLowerCase();
	const secretKey = normalizedProvider ? `oaicopilot.apiKey.${normalizedProvider}` : "oaicopilot.apiKey";
	const existing = await context.secrets.get(secretKey);
	const title = normalizedProvider ? `OAIProxy API Key for ${normalizedProvider}` : "OAIProxy API Key";
	const prompt = existing
		? `Update ${normalizedProvider ? `API key for ${normalizedProvider}` : "your OAIProxy API key"}`
		: `Enter ${normalizedProvider ? `API key for ${normalizedProvider}` : "your OAIProxy API key"}`;
	const apiKey = await vscode.window.showInputBox({
		title,
		prompt,
		ignoreFocusOut: true,
		password: true,
		value: existing ?? "",
	});
	if (apiKey === undefined) {
		return;
	}

	if (!apiKey.trim()) {
		await context.secrets.delete(secretKey);
		refreshLanguageModels(provider);
		vscode.window.showInformationMessage(
			normalizedProvider ? `API key for ${normalizedProvider} cleared.` : "OAIProxy API key cleared."
		);
		return;
	}

	await context.secrets.store(secretKey, apiKey.trim());
	refreshLanguageModels(provider);
	vscode.window.showInformationMessage(
		normalizedProvider ? `API key for ${normalizedProvider} saved.` : "OAIProxy API key saved."
	);
}

function getProviderKeyTargets(userModels: HFModelItem[]): ProviderKeyTarget[] {
	const providers = new Map<string, string>();
	for (const model of userModels) {
		const provider = model.owned_by?.trim();
		if (!provider || !model.baseUrl) {
			continue;
		}
		const normalizedProvider = provider.toLowerCase();
		if (!providers.has(normalizedProvider)) {
			providers.set(normalizedProvider, provider);
		}
	}

	return Array.from(providers, ([provider, label]) => ({ provider, label })).sort((a, b) =>
		a.label.localeCompare(b.label)
	);
}

function getProviderFromCommandArgs(args: readonly unknown[], userModels: HFModelItem[]): string | undefined {
	for (const arg of args) {
		const provider = getProviderFromCommandArg(arg, userModels);
		if (provider) {
			return provider;
		}
	}
	return undefined;
}

function getProviderFromCommandArg(arg: unknown, userModels: HFModelItem[]): string | undefined {
	if (typeof arg === "string") {
		return getProviderFromString(arg, userModels);
	}
	if (!arg || typeof arg !== "object") {
		return undefined;
	}

	const directProvider = getModelProviderId(arg);
	if (directProvider) {
		return getProviderFromString(directProvider, userModels);
	}

	const obj = arg as Record<string, unknown>;
	for (const key of ["id", "modelId", "name"]) {
		const provider = getProviderFromString(obj[key], userModels);
		if (provider) {
			return provider;
		}
	}

	for (const key of ["model", "item"]) {
		const provider = getProviderFromCommandArg(obj[key], userModels);
		if (provider) {
			return provider;
		}
	}

	return undefined;
}

function getProviderFromString(value: unknown, userModels: HFModelItem[]): string | undefined {
	if (typeof value !== "string" || !value.trim()) {
		return undefined;
	}

	const trimmed = value.trim();
	const normalized = trimmed.toLowerCase();
	const providerTargets = getProviderKeyTargets(userModels);
	const matchedProvider = providerTargets.find((target) => target.provider === normalized);
	if (matchedProvider) {
		return matchedProvider.provider;
	}

	const parsedModelId = parseModelId(trimmed);
	const matchedModel = userModels.find((model) => {
		if (model.id !== parsedModelId.baseId || !model.baseUrl) {
			return false;
		}
		return parsedModelId.configId ? model.configId === parsedModelId.configId : true;
	});
	return matchedModel?.owned_by?.trim().toLowerCase();
}

function recordExtensionLifecycle(context: vscode.ExtensionContext): void {
	const version = VersionManager.getVersion();
	const previousVersion = context.globalState.get<string>(LAST_ACTIVATED_VERSION_KEY);
	const event = previousVersion === undefined ? "install" : previousVersion === version ? "activate" : "update";

	logger.lifecycle("extension.lifecycle", {
		event,
		extensionId: context.extension.id,
		version,
		previousVersion: previousVersion ?? null,
		vscodeVersion: vscode.version,
		extensionMode: getExtensionModeName(context.extensionMode),
		uiKind: getUiKindName(vscode.env.uiKind),
		language: vscode.env.language,
	});

	if (previousVersion !== version) {
		void context.globalState.update(LAST_ACTIVATED_VERSION_KEY, version).then(undefined, (error) => {
			logger.warn("extension.lifecycle.persist.failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
}

function getExtensionModeName(mode: vscode.ExtensionMode): string {
	switch (mode) {
		case vscode.ExtensionMode.Development:
			return "development";
		case vscode.ExtensionMode.Test:
			return "test";
		default:
			return "production";
	}
}

function getUiKindName(uiKind: vscode.UIKind): string {
	return uiKind === vscode.UIKind.Web ? "web" : "desktop";
}

function refreshLanguageModels(provider: HuggingFaceChatModelProvider): void {
	provider.refreshLanguageModelChatInformation();
	void warmLanguageModelCache();
}

function scheduleLanguageModelWarmup(context: vscode.ExtensionContext): void {
	for (const delayMs of [250, 1000, 3000]) {
		const timeout = setTimeout(() => {
			void warmLanguageModelCache();
		}, delayMs);
		context.subscriptions.push({ dispose: () => clearTimeout(timeout) });
	}
}

async function warmLanguageModelCache(): Promise<void> {
	try {
		const models = await vscode.lm.selectChatModels({ vendor: LANGUAGE_MODEL_VENDOR });
		logger.info("models.warmed", { count: models.length });
	} catch (e) {
		logger.warn("models.warm.failed", {
			error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
		});
	}
}

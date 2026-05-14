import * as vscode from "vscode";
import { HuggingFaceChatModelProvider } from "./provider";
import type { HFModelItem } from "./types";
import { initStatusBar } from "./statusBar";
import { ConfigViewPanel } from "./views/configView";
import { logger } from "./logger";
import { normalizeUserModels } from "./utils";
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
	const provider = new HuggingFaceChatModelProvider(context.secrets, tokenCountStatusBarItem);
	context.subscriptions.push(provider);
	// Register the provider under the vendor id used in package.json.
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(LANGUAGE_MODEL_VENDOR, provider));
	refreshLanguageModels(provider);
	scheduleLanguageModelWarmup(context);

	// Management command to configure API key
	context.subscriptions.push(
		vscode.commands.registerCommand("oaiproxy.setApikey", async () => {
			const existing = await context.secrets.get("oaicopilot.apiKey");
			const apiKey = await vscode.window.showInputBox({
				title: "OAIProxy API Key",
				prompt: existing ? "Update your OAIProxy API key" : "Enter your OAIProxy API key",
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			if (apiKey === undefined) {
				return; // user canceled
			}
			if (!apiKey.trim()) {
				await context.secrets.delete("oaicopilot.apiKey");
				refreshLanguageModels(provider);
				vscode.window.showInformationMessage("OAIProxy API key cleared.");
				return;
			}
			await context.secrets.store("oaicopilot.apiKey", apiKey.trim());
			refreshLanguageModels(provider);
			vscode.window.showInformationMessage("OAIProxy API key saved.");
		})
	);

	// Management command to configure provider-specific API keys
	context.subscriptions.push(
		vscode.commands.registerCommand("oaiproxy.setProviderApikey", async () => {
			// Get provider list from configuration
			const config = vscode.workspace.getConfiguration();
			const userModels = normalizeUserModels(config.get<HFModelItem[]>("oaicopilot.models", []));

			// Extract unique providers (case-insensitive)
			const providers = Array.from(
				new Set(userModels.map((m) => m.owned_by.toLowerCase()).filter((p) => p && p.trim() !== ""))
			).sort();

			if (providers.length === 0) {
				vscode.window.showErrorMessage(
					"No providers found in oaicopilot.models configuration. Please configure models first."
				);
				return;
			}

			// Let user select provider
			const selectedProvider = await vscode.window.showQuickPick(providers, {
				title: "Select Provider",
				placeHolder: "Select a provider to configure API key",
			});

			if (!selectedProvider) {
				return; // user canceled
			}

			// Get existing API key for selected provider
			const providerKey = `oaicopilot.apiKey.${selectedProvider}`;
			const existing = await context.secrets.get(providerKey);

			// Prompt for API key
			const apiKey = await vscode.window.showInputBox({
				title: `OAIProxy API Key for ${selectedProvider}`,
				prompt: existing ? `Update API key for ${selectedProvider}` : `Enter API key for ${selectedProvider}`,
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});

			if (apiKey === undefined) {
				return; // user canceled
			}

			if (!apiKey.trim()) {
				await context.secrets.delete(providerKey);
				refreshLanguageModels(provider);
				vscode.window.showInformationMessage(`API key for ${selectedProvider} cleared.`);
				return;
			}

			await context.secrets.store(providerKey, apiKey.trim());
			refreshLanguageModels(provider);
			vscode.window.showInformationMessage(`API key for ${selectedProvider} saved.`);
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
				refreshLanguageModels(provider);
			}
		})
	);
}

export function deactivate() {}

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

import * as vscode from "vscode";
import { randomBytes } from "crypto";
import type { HFApiMode, HFModelItem, ProviderConfigItem } from "../types";
import { normalizeUserModels, parseModelId } from "../utils";
import { fetchModels } from "../provideModel";
import { VersionManager } from "../versionManager";
import { PROVIDER_PRESETS, type ProviderPreset } from "../providerPresets";
import { MODEL_PRESETS, type ModelPreset } from "../modelPresets";
import {
	deleteProviderConfig,
	findProviderPlaceholderModel,
	findProviderTransportModel,
	normalizeProviderConfigs,
	PROVIDER_CONFIG_STORAGE_KEY,
	resolveInheritedProviderModels,
	toProviderInheritedModel,
	upsertProviderConfig,
} from "../providerTransport";
import {
	checkProviderUsage,
	getProviderSecretKey,
	getProviderUsageAdapter,
	getProviderUsageSecretKey,
	getProviderUsageUnsupportedReason,
	providerRequiresUsageApiKey,
	type ProviderUsageResult,
} from "../providerUsage";

interface InitPayload {
	baseUrl: string;
	apiKey: string;
	delay: number;
	readFileLines: number;
	retry: {
		enabled?: boolean;
		max_attempts?: number;
		interval_ms?: number;
		status_codes?: number[];
	};
	commitModel: string;
	commitLanguage: string;
	models: HFModelItem[];
	providers: ProviderConfigItem[];
	providerKeys: Record<string, string>;
	providerUsageKeys: Record<string, string>;
	providerPresets: readonly ProviderPreset[];
	modelPresets: readonly ModelPreset[];
}

export type ProviderApiKeyChange =
	| { kind: "store"; secretKey: string; legacySecretKey?: string; value: string }
	| { kind: "delete"; secretKey: string; legacySecretKey?: string }
	| { kind: "preserve"; secretKey: string; legacySecretKey?: string };

export function resolveProviderApiKeyChange(
	provider: string,
	apiKey?: string,
	clearApiKey = false
): ProviderApiKeyChange {
	const trimmedProvider = provider.trim();
	const normalizedProvider = trimmedProvider.toLowerCase();
	const secretKey = getProviderSecretKey(trimmedProvider);
	const legacySecretKey = trimmedProvider !== normalizedProvider ? `oaicopilot.apiKey.${trimmedProvider}` : undefined;

	if (clearApiKey) {
		return { kind: "delete", secretKey, legacySecretKey };
	}

	const trimmedApiKey = apiKey?.trim();
	if (trimmedApiKey) {
		return { kind: "store", secretKey, legacySecretKey, value: trimmedApiKey };
	}

	return { kind: "preserve", secretKey, legacySecretKey };
}

export interface BatchAddModelsResult {
	models: HFModelItem[];
	added: HFModelItem[];
	skipped: HFModelItem[];
}

export interface BatchDeleteModelsResult {
	models: HFModelItem[];
	removedIds: string[];
}

export interface BatchAddModelsOptions {
	inheritProvider?: boolean;
	providerConfigs?: readonly ProviderConfigItem[];
}

export function getModelConfigKey(model: Pick<HFModelItem, "id" | "configId">): string {
	return `${model.id}${model.configId ? "::" + model.configId : ""}`;
}

export function resolveBatchAddModels(
	existingModels: HFModelItem[],
	candidateModels: HFModelItem[],
	options: BatchAddModelsOptions = {}
): BatchAddModelsResult {
	const prepared = options.inheritProvider
		? resolveInheritedProviderModels(existingModels, candidateModels, options.providerConfigs ?? [])
		: { models: [...existingModels], inheritedModels: candidateModels };
	const existingKeys = new Set(prepared.models.map(getModelConfigKey));
	const models = [...prepared.models];
	const added: HFModelItem[] = [];
	const skipped: HFModelItem[] = [];

	for (const model of prepared.inheritedModels) {
		const key = getModelConfigKey(model);
		if (existingKeys.has(key)) {
			skipped.push(model);
			continue;
		}

		existingKeys.add(key);
		models.push(model);
		added.push(model);
	}

	return { models, added, skipped };
}

export function resolveBatchDeleteModels(existingModels: HFModelItem[], modelIds: string[]): BatchDeleteModelsResult {
	const targets = modelIds.map(parseModelId);
	const removedIds: string[] = [];
	const models = existingModels.filter((model) => {
		const shouldRemove = targets.some((target) => {
			return (
				model.id === target.baseId &&
				((target.configId && model.configId === target.configId) || (!target.configId && !model.configId))
			);
		});
		if (shouldRemove) {
			removedIds.push(getModelConfigKey(model));
		}
		return !shouldRemove;
	});

	return { models, removedIds };
}

function migrateProviderPlaceholderModels(
	models: readonly HFModelItem[],
	providers: readonly ProviderConfigItem[]
): { models: HFModelItem[]; providers: ProviderConfigItem[]; changed: boolean } {
	let nextProviders = [...providers];
	const nextModels: HFModelItem[] = [];
	let changed = false;

	for (const model of models) {
		if (!findProviderPlaceholderModel([model], model.owned_by)) {
			nextModels.push(model);
			continue;
		}

		changed = true;
		nextProviders = upsertProviderConfig(nextProviders, model.owned_by, {
			baseUrl: model.baseUrl,
			apiMode: model.apiMode,
			headers: model.headers,
		});
	}

	return { models: nextModels, providers: nextProviders, changed };
}

interface ExportConfig {
	version: string;
	exportDate: string;
	baseUrl: string;
	apiKey: string;
	delay: number;
	retry: {
		enabled?: boolean;
		max_attempts?: number;
		interval_ms?: number;
		status_codes?: number[];
	};
	commitLanguage: string;
	commitModel: string;
	models: HFModelItem[];
	providers?: ProviderConfigItem[];
	providerKeys: Record<string, string>;
	providerUsageKeys?: Record<string, string>;
	readFileLines: number;
}

type IncomingMessage =
	| { type: "requestInit" }
	| {
			type: "saveGlobalConfig";
			baseUrl: string;
			apiKey: string;
			delay: number;
			readFileLines: number;
			retry: { enabled?: boolean; max_attempts?: number; interval_ms?: number; status_codes?: number[] };
			commitModel: string;
			commitLanguage: string;
	  }
	| {
			type: "fetchModels";
			baseUrl: string;
			apiKey: string;
			apiMode?: HFApiMode | string;
			headers?: Record<string, string>;
	  }
	| {
			type: "addProvider";
			provider: string;
			baseUrl?: string;
			apiKey?: string;
			clearApiKey?: boolean;
			apiMode?: string;
			headers?: Record<string, string>;
	  }
	| {
			type: "updateProvider";
			provider: string;
			baseUrl?: string;
			apiKey?: string;
			clearApiKey?: boolean;
			apiMode?: string;
			headers?: Record<string, string>;
	  }
	| { type: "deleteProvider"; provider: string }
	| { type: "checkProviderUsage"; provider: string; usageApiKey?: string }
	| { type: "addModel"; model: HFModelItem; providerApiKey?: string; inheritProvider?: boolean }
	| { type: "addModels"; models: HFModelItem[]; providerApiKeys?: Record<string, string>; inheritProvider?: boolean }
	| {
			type: "updateModel";
			model: HFModelItem;
			originalModelId?: string;
			originalConfigId?: string;
			providerApiKey?: string;
			inheritProvider?: boolean;
	  }
	| { type: "deleteModel"; modelId: string }
	| { type: "deleteModels"; modelIds: string[] }
	| { type: "requestConfirm"; id: string; message: string; action: string }
	| { type: "exportConfig" }
	| { type: "importConfig" };

type OutgoingMessage =
	| { type: "init"; payload: InitPayload }
	| { type: "modelsFetched"; models: HFModelItem[] }
	| { type: "providerUsageResult"; provider: string; result: ProviderUsageResult }
	| { type: "providerUsageError"; provider: string; error: string }
	| { type: "confirmResponse"; id: string; confirmed: boolean };

export class ConfigViewPanel {
	public static currentPanel: ConfigViewPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly secrets: vscode.SecretStorage;
	private readonly onConfigurationChanged?: () => void;
	private disposables: vscode.Disposable[] = [];

	public static openPanel(
		extensionUri: vscode.Uri,
		secrets: vscode.SecretStorage,
		globalState: vscode.Memento,
		onConfigurationChanged?: () => void
	) {
		const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

		if (ConfigViewPanel.currentPanel) {
			ConfigViewPanel.currentPanel.panel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			"oaiproxy.config",
			"OAIProxy Configuration",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out"), vscode.Uri.joinPath(extensionUri, "assets")],
			}
		);
		panel.iconPath = vscode.Uri.joinPath(extensionUri, "assets", "icon.png");

		ConfigViewPanel.currentPanel = new ConfigViewPanel(panel, extensionUri, secrets, globalState, onConfigurationChanged);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		secrets: vscode.SecretStorage,
		private readonly globalState: vscode.Memento,
		onConfigurationChanged?: () => void
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.secrets = secrets;
		this.onConfigurationChanged = onConfigurationChanged;

		this.update();

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		this.panel.webview.onDidReceiveMessage(
			async (message) => {
				this.handleMessage(message).catch((err) => {
					console.error("[oaiproxy] handleMessage failed", err);
					vscode.window.showErrorMessage(
						err instanceof Error
							? err.message
							: `Unexpected error while handling configuration message[${message.type}].`
					);
				});
			},
			null,
			this.disposables
		);

		// Send initialization data
		this.sendInit();
	}

	private async update() {
		const webview = this.panel.webview;
		this.panel.webview.html = await this.getHtml(webview);
	}

	public dispose() {
		ConfigViewPanel.currentPanel = undefined;

		this.panel.dispose();

		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	async handleMessage(message: IncomingMessage) {
		switch (message.type) {
			case "requestInit":
				await this.sendInit();
				break;
			case "saveGlobalConfig":
				await this.saveGlobalConfig(
					message.baseUrl,
					message.apiKey,
					message.delay,
					message.readFileLines,
					message.retry,
					message.commitModel,
					message.commitLanguage
				);
				break;
			case "fetchModels": {
				try {
					const { models } = await fetchModels(message.baseUrl, message.apiKey, message.apiMode, message.headers);
					this.panel.webview.postMessage({ type: "modelsFetched", models });
				} catch (err) {
					console.error("[oaiproxy] fetchModels failed", err);
					const errorMessage = err instanceof Error ? err.message : String(err);
					this.panel.webview.postMessage({ type: "modelsFetchError", error: errorMessage });
				}
				break;
			}
			case "addProvider":
				await this.addProvider(
					message.provider,
					message.baseUrl,
					message.apiKey,
					message.clearApiKey,
					message.apiMode,
					message.headers
				);
				break;
			case "updateProvider":
				await this.updateProvider(
					message.provider,
					message.baseUrl,
					message.apiKey,
					message.clearApiKey,
					message.apiMode,
					message.headers
				);
				break;
			case "deleteProvider":
				await this.deleteProvider(message.provider);
				break;
			case "checkProviderUsage":
				await this.checkProviderUsage(message.provider, message.usageApiKey);
				break;
			case "addModel":
				await this.addModel(message.model, message.providerApiKey, message.inheritProvider);
				break;
			case "addModels":
				await this.addModels(message.models, message.providerApiKeys, message.inheritProvider);
				break;
			case "updateModel":
				await this.updateModel(
					message.model,
					message.originalModelId,
					message.originalConfigId,
					message.providerApiKey,
					message.inheritProvider
				);
				break;
			case "requestConfirm":
				await this.handleConfirmRequest(message.id, message.message, message.action);
				break;
			case "deleteModel":
				await this.deleteModel(message.modelId);
				break;
			case "deleteModels":
				await this.deleteModels(message.modelIds);
				break;
			case "exportConfig":
				await this.exportConfig();
				break;
			case "importConfig":
				await this.importConfig();
				break;
			default:
				break;
		}
	}

	private async handleConfirmRequest(id: string, message: string, action: string) {
		let confirmed: boolean | string | undefined;

		if (action === "showInfo") {
			// For informational messages, just show the message without confirmation
			await vscode.window.showInformationMessage(message);
			confirmed = true;
		} else {
			// For confirmation requests, show Yes/No dialog
			confirmed = await vscode.window.showInformationMessage(message, { modal: true }, "Yes", "No");
		}

		// Send response back to webview
		this.panel.webview.postMessage({
			type: "confirmResponse",
			id: id,
			confirmed: action === "showInfo" ? true : confirmed === "Yes",
		} as OutgoingMessage);
	}

	private async sendInit() {
		const config = vscode.workspace.getConfiguration();
		const baseUrl = config.get<string>("oaicopilot.baseUrl", "https://api.openai.com/v1");
		let models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		let providerConfigs = this.getProviderConfigs();
		const migrated = migrateProviderPlaceholderModels(models, providerConfigs);
		if (migrated.changed) {
			models = migrated.models;
			providerConfigs = migrated.providers;
			await config.update("oaicopilot.models", models, vscode.ConfigurationTarget.Global);
			await this.updateProviderConfigs(providerConfigs);
		}

		const apiKey = (await this.secrets.get("oaicopilot.apiKey")) ?? "";
		const providerKeys: Record<string, string> = {};
		const providerUsageKeys: Record<string, string> = {};
		const providerIds = Array.from(
			new Set([
				...models.map((m) => m.owned_by).filter(Boolean),
				...providerConfigs.map((provider) => provider.provider).filter(Boolean),
				...PROVIDER_PRESETS.map((preset) => preset.provider),
				...MODEL_PRESETS.map((preset) => preset.model.owned_by).filter(Boolean),
			])
		);
		for (const provider of providerIds) {
			const normalized = provider.toLowerCase();
			let key = await this.secrets.get(`oaicopilot.apiKey.${normalized}`);
			if (!key && normalized !== provider) {
				// Backward compat: previous versions stored provider keys with original casing.
				const legacy = await this.secrets.get(`oaicopilot.apiKey.${provider}`);
				if (legacy) {
					key = legacy;
					await this.secrets.store(`oaicopilot.apiKey.${normalized}`, legacy);
					await this.secrets.delete(`oaicopilot.apiKey.${provider}`);
				}
			}
			if (key) {
				providerKeys[provider] = key;
			}
			const usageKey = await this.secrets.get(getProviderUsageSecretKey(provider));
			if (usageKey) {
				providerUsageKeys[provider] = usageKey;
			}
		}

		const delay = config.get<number>("oaicopilot.delay", 0);
		const retry = config.get<{
			enabled?: boolean;
			max_attempts?: number;
			interval_ms?: number;
			status_codes?: number[];
		}>("oaicopilot.retry", {
			enabled: true,
			max_attempts: 3,
			interval_ms: 1000,
		});

		const foundModel = models.find((model) => model.useForCommitGeneration === true);
		const commitModel = foundModel ? `${foundModel.id}${foundModel.configId ? "::" + foundModel.configId : ""}` : "";
		const commitLanguage = config.get<string>("oaicopilot.commitLanguage", "English");
		const readFileLines = config.get<number>("oaicopilot.readFileLines", 0);
		const payload: InitPayload = {
			baseUrl,
			apiKey,
			delay,
			readFileLines,
			retry,
			commitModel,
			commitLanguage,
			models,
			providers: providerConfigs,
			providerKeys,
			providerUsageKeys,
			providerPresets: PROVIDER_PRESETS,
			modelPresets: MODEL_PRESETS,
		};
		this.panel.webview.postMessage({ type: "init", payload });
	}

	private async saveGlobalConfig(
		rawBaseUrl: string,
		rawApiKey: string,
		delay: number,
		readFileLines: number,
		retry: { enabled?: boolean; max_attempts?: number; interval_ms?: number; status_codes?: number[] },
		commitModel: string,
		commitLanguage: string
	) {
		const baseUrl = rawBaseUrl.trim();
		const apiKey = rawApiKey.trim();
		const config = vscode.workspace.getConfiguration();
		await config.update("oaicopilot.baseUrl", baseUrl, vscode.ConfigurationTarget.Global);
		await config.update("oaicopilot.delay", delay, vscode.ConfigurationTarget.Global);
		await config.update("oaicopilot.readFileLines", readFileLines, vscode.ConfigurationTarget.Global);
		await config.update("oaicopilot.retry", retry, vscode.ConfigurationTarget.Global);
		await config.update("oaicopilot.commitLanguage", commitLanguage, vscode.ConfigurationTarget.Global);
		if (apiKey) {
			await this.secrets.store("oaicopilot.apiKey", apiKey);
		} else {
			await this.secrets.delete("oaicopilot.apiKey");
		}

		// Update models to set useForCommitGeneration based on selected commitModel
		if (commitModel) {
			const models = config.get<HFModelItem[]>("oaicopilot.models", []);
			const updatedModels = models.map((model) => {
				const fullModelId = `${model.id}${model.configId ? "::" + model.configId : ""}`;
				if (fullModelId === commitModel) {
					return { ...model, useForCommitGeneration: true };
				} else {
					const rest = { ...model };
					delete rest.useForCommitGeneration;
					return rest;
				}
			});
			await config.update("oaicopilot.models", updatedModels, vscode.ConfigurationTarget.Global);
		}

		vscode.window.showInformationMessage(
			"OAIProxy base URL, Delay, Retry and API Key have been saved to global settings."
		);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async getHtml(webview: vscode.Webview) {
		const nonce = this.getNonce();
		const assetsRoot = vscode.Uri.joinPath(this.extensionUri, "assets", "configView");
		const templatePath = vscode.Uri.joinPath(assetsRoot, "configView.html");
		const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "configView.css"));
		const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "configView.js"));
		const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "logo.png"));
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} https:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src ${webview.cspSource} 'nonce-${nonce}'`,
		].join("; ");

		const raw = await vscode.workspace.fs.readFile(templatePath);
		let html = new TextDecoder("utf-8").decode(raw);
		html = html
			.replaceAll("%CSP_SOURCE%", csp)
			.replaceAll("%NONCE%", nonce)
			.replace("%LOGO_URI%", logoUri.toString())
			.replace("%CSS_URI%", cssUri.toString())
			.replace("%SCRIPT_URI%", jsUri.toString());
		return html;
	}

	private getNonce() {
		return randomBytes(16).toString("hex");
	}

	private refreshConfiguration() {
		this.onConfigurationChanged?.();
	}

	private getProviderConfigs(): ProviderConfigItem[] {
		return normalizeProviderConfigs(this.globalState.get<unknown>(PROVIDER_CONFIG_STORAGE_KEY, []));
	}

	private async updateProviderConfigs(providers: readonly ProviderConfigItem[]): Promise<void> {
		await this.globalState.update(PROVIDER_CONFIG_STORAGE_KEY, providers);
	}

	private async applyProviderApiKeyChange(provider: string, apiKey?: string, clearApiKey = false): Promise<void> {
		const change = resolveProviderApiKeyChange(provider, apiKey, clearApiKey);
		if (change.kind === "store") {
			await this.secrets.store(change.secretKey, change.value);
			if (change.legacySecretKey) {
				await this.secrets.delete(change.legacySecretKey);
			}
			return;
		}
		if (change.kind === "delete") {
			await this.secrets.delete(change.secretKey);
			if (change.legacySecretKey) {
				await this.secrets.delete(change.legacySecretKey);
			}
		}
	}

	private async addProvider(
		provider: string,
		baseUrl?: string,
		apiKey?: string,
		clearApiKey?: boolean,
		apiMode?: string,
		headers?: Record<string, string>
	) {
		const trimmedProvider = provider.trim();
		if (!trimmedProvider) {
			vscode.window.showErrorMessage("Provider ID is required.");
			return;
		}
		await this.applyProviderApiKeyChange(trimmedProvider, apiKey, clearApiKey);

		const config = vscode.workspace.getConfiguration();
		const models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		const providers = this.getProviderConfigs();
		const migrated = migrateProviderPlaceholderModels(models, providers);
		const updatedProviders = upsertProviderConfig(migrated.providers, trimmedProvider, {
			baseUrl,
			apiMode: (apiMode as HFApiMode) || "openai",
			headers,
		});

		if (migrated.changed) {
			await config.update("oaicopilot.models", migrated.models, vscode.ConfigurationTarget.Global);
		}
		await this.updateProviderConfigs(updatedProviders);
		vscode.window.showInformationMessage(`Provider ${provider} has been added.`);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async updateProvider(
		provider: string,
		baseUrl?: string,
		apiKey?: string,
		clearApiKey?: boolean,
		apiMode?: string,
		headers?: Record<string, string>
	) {
		const trimmedProvider = provider.trim();
		if (!trimmedProvider) {
			vscode.window.showErrorMessage("Provider ID is required.");
			return;
		}
		await this.applyProviderApiKeyChange(trimmedProvider, apiKey, clearApiKey);

		const config = vscode.workspace.getConfiguration();
		const models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		const providers = this.getProviderConfigs();
		const migrated = migrateProviderPlaceholderModels(models, providers);
		const existingProviderModel = findProviderTransportModel(migrated.models, trimmedProvider, migrated.providers);
		const updatedProviders = upsertProviderConfig(migrated.providers, trimmedProvider, {
			baseUrl: baseUrl || existingProviderModel?.baseUrl,
			apiMode: ((apiMode as HFApiMode) || existingProviderModel?.apiMode || "openai") as HFApiMode,
			headers,
		});

		if (migrated.changed) {
			await config.update("oaicopilot.models", migrated.models, vscode.ConfigurationTarget.Global);
		}
		await this.updateProviderConfigs(updatedProviders);
		vscode.window.showInformationMessage(`Provider ${provider} has been updated.`);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async deleteProvider(provider: string) {
		const trimmedProvider = provider.trim();
		if (!trimmedProvider) {
			vscode.window.showErrorMessage("Provider ID is required.");
			return;
		}
		const normalizedProvider = trimmedProvider.toLowerCase();
		await this.applyProviderApiKeyChange(trimmedProvider, undefined, true);
		await this.secrets.delete(getProviderUsageSecretKey(normalizedProvider));
		if (trimmedProvider !== normalizedProvider) {
			await this.secrets.delete(getProviderUsageSecretKey(trimmedProvider));
		}

		// Remove all models of this provider from the model list
		const config = vscode.workspace.getConfiguration();
		const models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		const providers = this.getProviderConfigs();
		const filteredModels = models.filter((model) => model.owned_by !== trimmedProvider);
		const updatedProviders = deleteProviderConfig(providers, trimmedProvider);

		await config.update("oaicopilot.models", filteredModels, vscode.ConfigurationTarget.Global);
		await this.updateProviderConfigs(updatedProviders);
		vscode.window.showInformationMessage(`Provider ${provider} and all its models have been deleted.`);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async checkProviderUsage(provider: string, usageApiKey?: string) {
		const trimmedProvider = provider.trim();
		const normalizedProvider = trimmedProvider.toLowerCase();
		try {
			const config = vscode.workspace.getConfiguration();
			const models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
			const providers = this.getProviderConfigs();
			const model =
				findProviderTransportModel(models, trimmedProvider, providers) ??
				models.find((item) => item.owned_by?.trim().toLowerCase() === normalizedProvider && item.baseUrl);
			const baseUrl = model?.baseUrl;
			const adapter = getProviderUsageAdapter(trimmedProvider, baseUrl);
			if (!adapter) {
				throw new Error(
					getProviderUsageUnsupportedReason(trimmedProvider, baseUrl) ??
						`Provider ${trimmedProvider} does not support usage checks yet.`
				);
			}

			const secretKey = providerRequiresUsageApiKey(adapter)
				? getProviderUsageSecretKey(trimmedProvider)
				: getProviderSecretKey(trimmedProvider);
			const providerApiKey = await this.secrets.get(getProviderSecretKey(trimmedProvider));
			const trimmedUsageApiKey = usageApiKey?.trim();
			if (providerRequiresUsageApiKey(adapter) && trimmedUsageApiKey) {
				await this.secrets.store(secretKey, trimmedUsageApiKey);
			}
			const apiKey = providerRequiresUsageApiKey(adapter) && trimmedUsageApiKey
				? trimmedUsageApiKey
				: await this.secrets.get(secretKey);
			if (!apiKey) {
				throw new Error(
					providerRequiresUsageApiKey(adapter)
						? `No usage/admin API key found for provider ${trimmedProvider}. Add it in the Usage Key field first.`
						: `No API key found for provider ${trimmedProvider}. Configure its provider API key first.`
				);
			}
			if (adapter === "litellm" && !providerApiKey) {
				throw new Error(`No LiteLLM provider API key found for ${trimmedProvider}. Save the provider key first.`);
			}

			const result = await checkProviderUsage({
				provider: trimmedProvider,
				baseUrl,
				apiKey,
				targetApiKey: adapter === "litellm" ? providerApiKey : undefined,
			});
			this.panel.webview.postMessage({
				type: "providerUsageResult",
				provider: trimmedProvider,
				result,
			} as OutgoingMessage);
		} catch (error) {
			this.panel.webview.postMessage({
				type: "providerUsageError",
				provider: trimmedProvider,
				error: error instanceof Error ? error.message : String(error),
			} as OutgoingMessage);
		}
	}

	private async applyModelApiKey(model: HFModelItem, providerApiKey?: string, inheritProvider = false) {
		const trimmedApiKey = providerApiKey?.trim();
		if (!trimmedApiKey) {
			return;
		}

		if (inheritProvider || model.inheritProvider === true || model.baseUrl) {
			await this.applyProviderApiKeyChange(model.owned_by, trimmedApiKey);
			return;
		}

		await this.secrets.store("oaicopilot.apiKey", trimmedApiKey);
	}

	private async addModel(model: HFModelItem, providerApiKey?: string, inheritProvider = false) {
		const config = vscode.workspace.getConfiguration();
		let models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		const providers = this.getProviderConfigs();
		const modelToAdd = inheritProvider ? toProviderInheritedModel(model) : model;
		if (inheritProvider) {
			models = resolveInheritedProviderModels(models, [model], providers).models;
		}

		// Check if model with same id and configId already exists
		const existingIndex = models.findIndex(
			(m) =>
				m.id === modelToAdd.id &&
				((modelToAdd.configId && m.configId === modelToAdd.configId) || (!modelToAdd.configId && !m.configId))
		);
		if (existingIndex !== -1) {
			vscode.window.showErrorMessage(
				`Model ${modelToAdd.id}${modelToAdd.configId ? "::" + modelToAdd.configId : ""} already exists.`
			);
			return;
		}

		await this.applyModelApiKey(modelToAdd, providerApiKey, inheritProvider);
		models.push(modelToAdd);
		await config.update("oaicopilot.models", models, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(
			`Model ${modelToAdd.id}${modelToAdd.configId ? "::" + modelToAdd.configId : ""} has been added.`
		);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async addModels(
		modelsToAdd: HFModelItem[],
		providerApiKeys?: Record<string, string>,
		inheritProvider = false
	) {
		const config = vscode.workspace.getConfiguration();
		const models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		const providers = this.getProviderConfigs();
		const result = resolveBatchAddModels(models, modelsToAdd, { inheritProvider, providerConfigs: providers });

		if (result.added.length === 0) {
			vscode.window.showInformationMessage("No new models were added.");
			await this.sendInit();
			return;
		}

		for (const model of result.added) {
			await this.applyModelApiKey(model, providerApiKeys?.[model.owned_by], inheritProvider);
		}

		await config.update("oaicopilot.models", result.models, vscode.ConfigurationTarget.Global);
		const skippedSuffix = result.skipped.length ? ` ${result.skipped.length} already configured.` : "";
		vscode.window.showInformationMessage(`${result.added.length} model(s) have been added.${skippedSuffix}`);
		this.refreshConfiguration();
		await this.sendInit();
	}

	private async updateModel(
		model: HFModelItem,
		originalModelId?: string,
		originalConfigId?: string,
		providerApiKey?: string,
		inheritProvider = false
	) {
		const config = vscode.workspace.getConfiguration();
		let models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
		const providers = this.getProviderConfigs();
		const shouldInheritProvider = inheritProvider || model.inheritProvider === true;
		const modelToUpdate = shouldInheritProvider ? toProviderInheritedModel(model) : model;
		if (shouldInheritProvider) {
			models = resolveInheritedProviderModels(models, [model], providers).models;
		}

		// Find the model to update based on original id and configId
		const updatedModels = models.map((m) => {
			// Check if this is the model we want to update
			// If originalConfigId is undefined (meaning it was originally null/undefined),
			// then look for a model with no configId
			const isTargetModel =
				m.id === originalModelId &&
				((originalConfigId && m.configId === originalConfigId) || (!originalConfigId && !m.configId));

			if (isTargetModel) {
				// Update with new values
				return modelToUpdate;
			}
			return m;
		});

		await this.applyModelApiKey(modelToUpdate, providerApiKey, shouldInheritProvider);
		await config.update("oaicopilot.models", updatedModels, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(
			`Model ${modelToUpdate.id}${modelToUpdate.configId ? "::" + modelToUpdate.configId : ""} has been updated.`
		);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async deleteModel(modelId: string) {
		const config = vscode.workspace.getConfiguration();
		const models = config.get<HFModelItem[]>("oaicopilot.models", []);
		const parsedModelId = parseModelId(modelId);

		const filteredModels = models.filter((model) => {
			return !(
				model.id === parsedModelId.baseId &&
				((parsedModelId.configId && model.configId === parsedModelId.configId) ||
					(!parsedModelId.configId && !model.configId))
			);
		});

		await config.update("oaicopilot.models", filteredModels, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Model ${modelId} has been deleted.`);
		this.refreshConfiguration();
		// Send refresh signal to frontend
		await this.sendInit();
	}

	private async deleteModels(modelIds: string[]) {
		const config = vscode.workspace.getConfiguration();
		const models = config.get<HFModelItem[]>("oaicopilot.models", []);
		const result = resolveBatchDeleteModels(models, modelIds);

		if (result.removedIds.length === 0) {
			vscode.window.showInformationMessage("No matching models were deleted.");
			await this.sendInit();
			return;
		}

		await config.update("oaicopilot.models", result.models, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`${result.removedIds.length} model(s) have been deleted.`);
		this.refreshConfiguration();
		await this.sendInit();
	}

	private async exportConfig() {
		try {
			const config = vscode.workspace.getConfiguration();
			const baseUrl = config.get<string>("oaicopilot.baseUrl", "https://api.openai.com/v1");
			const apiKey = (await this.secrets.get("oaicopilot.apiKey")) ?? "";
			const delay = config.get<number>("oaicopilot.delay", 0);
			const retry = config.get<{
				enabled?: boolean;
				max_attempts?: number;
				interval_ms?: number;
				status_codes?: number[];
			}>("oaicopilot.retry", {
				enabled: true,
				max_attempts: 3,
				interval_ms: 1000,
			});
			const commitLanguage = config.get<string>("oaicopilot.commitLanguage", "English");
			const readFileLines = config.get<number>("oaicopilot.readFileLines", 0);
			const models = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));
			const providerConfigs = this.getProviderConfigs();

			const foundModel = models.find((model) => model.useForCommitGeneration === true);
			const commitModel = foundModel ? `${foundModel.id}${foundModel.configId ? "::" + foundModel.configId : ""}` : "";

			const providerKeys: Record<string, string> = {};
			const providerUsageKeys: Record<string, string> = {};
			const providerIds = Array.from(
				new Set([...models.map((m) => m.owned_by).filter(Boolean), ...providerConfigs.map((item) => item.provider)])
			);
			for (const provider of providerIds) {
				const normalized = provider.toLowerCase();
				const key = await this.secrets.get(`oaicopilot.apiKey.${normalized}`);
				if (key) {
					providerKeys[provider] = key;
				}
				const usageKey = await this.secrets.get(getProviderUsageSecretKey(provider));
				if (usageKey) {
					providerUsageKeys[provider] = usageKey;
				}
			}

			const exportData: ExportConfig = {
				version: VersionManager.getVersion(),
				exportDate: new Date().toISOString(),
				baseUrl,
				apiKey,
				delay,
				retry,
				commitLanguage,
				commitModel,
				models,
				providers: providerConfigs,
				readFileLines,
				providerKeys,
				providerUsageKeys,
			};

			const uri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`oaiproxy-config-${new Date().toISOString().split("T")[0]}.json`),
				filters: { "JSON Files": ["json"] },
				title: "Export OAIProxy Configuration",
			});

			if (!uri) {
				vscode.window.showInformationMessage("Export configuration cancelled.");
				return;
			}

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(uri, encoder.encode(JSON.stringify(exportData, null, 2)));

			vscode.window.showInformationMessage(`Configuration exported to ${uri.fsPath}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			vscode.window.showErrorMessage(`Failed to export configuration: ${errorMessage}`);
		}
	}

	private async importConfig() {
		try {
			const uri = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: { "JSON Files": ["json"] },
				title: "Import OAIProxy Configuration",
			});

			if (!uri || uri.length === 0) {
				vscode.window.showInformationMessage("Import configuration cancelled.");
				return;
			}

			const content = await vscode.workspace.fs.readFile(uri[0]);
			const decoder = new TextDecoder();
			const jsonContent = decoder.decode(content);
			const importData = JSON.parse(jsonContent) as ExportConfig;

			if (!Array.isArray(importData.models)) {
				throw new Error("Invalid configuration file: models must be an array");
			}
			const importedProviders = normalizeProviderConfigs(importData.providers ?? []);
			const migratedImport = migrateProviderPlaceholderModels(normalizeUserModels(importData.models), importedProviders);

			const config = vscode.workspace.getConfiguration();

			await config.update("oaicopilot.baseUrl", importData.baseUrl, vscode.ConfigurationTarget.Global);
			await config.update("oaicopilot.delay", importData.delay, vscode.ConfigurationTarget.Global);
			await config.update("oaicopilot.retry", importData.retry, vscode.ConfigurationTarget.Global);
			await config.update("oaicopilot.readFileLines", importData.readFileLines, vscode.ConfigurationTarget.Global);
			await config.update("oaicopilot.commitLanguage", importData.commitLanguage, vscode.ConfigurationTarget.Global);

			if (importData.apiKey) {
				await this.secrets.store("oaicopilot.apiKey", importData.apiKey);
			} else {
				await this.secrets.delete("oaicopilot.apiKey");
			}

			await config.update("oaicopilot.models", migratedImport.models, vscode.ConfigurationTarget.Global);
			await this.updateProviderConfigs(migratedImport.providers);

			for (const [provider, key] of Object.entries(importData.providerKeys)) {
				const normalized = provider.toLowerCase();
				if (key) {
					await this.secrets.store(`oaicopilot.apiKey.${normalized}`, key);
				} else {
					await this.secrets.delete(`oaicopilot.apiKey.${normalized}`);
				}
			}
			for (const [provider, key] of Object.entries(importData.providerUsageKeys ?? {})) {
				const normalized = provider.toLowerCase();
				if (key) {
					await this.secrets.store(getProviderUsageSecretKey(normalized), key);
				} else {
					await this.secrets.delete(getProviderUsageSecretKey(normalized));
				}
			}

			vscode.window.showInformationMessage("Configuration imported successfully.");
			this.refreshConfiguration();
			await this.sendInit();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			vscode.window.showErrorMessage(`Failed to import configuration: ${errorMessage}`);
		}
	}
}

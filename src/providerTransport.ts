import type { HFApiMode, HFModelItem, ProviderConfigItem } from "./types";
import { MODEL_PRESETS } from "./modelPresets";

export const PROVIDER_CONFIG_STORAGE_KEY = "oaiproxy.providers";

export interface ProviderTransportFields {
	baseUrl?: string;
	apiMode?: HFApiMode;
	headers?: Record<string, string>;
}

export interface InheritedProviderModelsResult {
	models: HFModelItem[];
	inheritedModels: HFModelItem[];
	providerRowsAdded: HFModelItem[];
}

export function normalizeProviderConfigs(providers: unknown): ProviderConfigItem[] {
	const list = Array.isArray(providers) ? providers : [];
	const out: ProviderConfigItem[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const obj = item as Record<string, unknown>;
		const provider = typeof obj.provider === "string" ? obj.provider.trim() : "";
		if (!provider) {
			continue;
		}
		const config: ProviderConfigItem = { provider };
		if (typeof obj.baseUrl === "string" && obj.baseUrl.trim()) {
			config.baseUrl = obj.baseUrl.trim();
		}
		if (isApiMode(obj.apiMode)) {
			config.apiMode = obj.apiMode;
		}
		if (obj.headers && typeof obj.headers === "object" && !Array.isArray(obj.headers)) {
			config.headers = obj.headers as Record<string, string>;
		}
		out.push(config);
	}
	return out;
}

export function upsertProviderConfig(
	providers: readonly ProviderConfigItem[],
	provider: string,
	transport: ProviderTransportFields
): ProviderConfigItem[] {
	const trimmedProvider = provider.trim();
	if (!trimmedProvider) {
		return [...providers];
	}

	const normalizedProvider = normalizeProvider(trimmedProvider);
	const next: ProviderConfigItem = {
		provider: trimmedProvider,
		apiMode: transport.apiMode ?? "openai",
	};
	if (transport.baseUrl !== undefined) {
		next.baseUrl = transport.baseUrl;
	}
	if (transport.headers !== undefined) {
		next.headers = transport.headers;
	}

	let found = false;
	const updated = providers.map((item) => {
		if (normalizeProvider(item.provider) !== normalizedProvider) {
			return item;
		}
		found = true;
		return {
			...item,
			...next,
			provider: item.provider || trimmedProvider,
		};
	});
	return found ? updated : [...updated, next];
}

export function deleteProviderConfig(providers: readonly ProviderConfigItem[], provider: string): ProviderConfigItem[] {
	const normalizedProvider = normalizeProvider(provider);
	return providers.filter((item) => normalizeProvider(item.provider) !== normalizedProvider);
}

export function getProviderConfig(
	providers: readonly ProviderConfigItem[],
	provider: string | undefined
): ProviderConfigItem | undefined {
	const normalizedProvider = normalizeProvider(provider);
	if (!normalizedProvider) {
		return undefined;
	}
	return providers.find((item) => normalizeProvider(item.provider) === normalizedProvider);
}

export function isProviderPlaceholderModel(model: Pick<HFModelItem, "id"> | undefined): boolean {
	return Boolean(model?.id?.startsWith("__provider__"));
}

export function getProviderPlaceholderId(provider: string): string {
	return `__provider__${provider.trim()}`;
}

export function findProviderPlaceholderModel(
	models: readonly HFModelItem[],
	provider: string | undefined
): HFModelItem | undefined {
	const normalizedProvider = normalizeProvider(provider);
	if (!normalizedProvider) {
		return undefined;
	}

	return models.find((model) => {
		return isProviderPlaceholderModel(model) && normalizeProvider(model.owned_by) === normalizedProvider;
	});
}

export function findProviderTransportModel(
	models: readonly HFModelItem[],
	provider: string | undefined,
	providerConfigs: readonly ProviderConfigItem[] = []
): HFModelItem | undefined {
	if (!provider?.trim()) {
		return undefined;
	}
	const providerConfig = getProviderConfig(providerConfigs, provider);
	if (providerConfig) {
		return providerConfigToModel(providerConfig);
	}
	return findProviderPlaceholderModel(models, provider) ?? findLegacyProviderTransportSource(models, provider);
}

export function toProviderInheritedModel(model: HFModelItem): HFModelItem {
	const next: HFModelItem = { ...model, inheritProvider: true };
	delete next.baseUrl;
	delete next.apiMode;
	delete next.headers;
	return next;
}

export function resolveInheritedProviderModels(
	existingModels: readonly HFModelItem[],
	candidateModels: readonly HFModelItem[],
	_providerConfigs: readonly ProviderConfigItem[] = []
): InheritedProviderModelsResult {
	return {
		models: [...existingModels],
		inheritedModels: candidateModels.map(toProviderInheritedModel),
		providerRowsAdded: [],
	};
}

export function resolveProviderBackedModel(
	model: HFModelItem | undefined,
	models: readonly HFModelItem[],
	providerConfigs: readonly ProviderConfigItem[] = []
): HFModelItem | undefined {
	if (!model || isProviderPlaceholderModel(model)) {
		return model;
	}

	const providerModel = findProviderTransportModel(models, model.owned_by, providerConfigs);
	if (!providerModel || !shouldUseProviderTransport(model)) {
		return model;
	}

	const next: HFModelItem = { ...model };
	if (providerModel.baseUrl !== undefined) {
		next.baseUrl = providerModel.baseUrl;
	} else {
		delete next.baseUrl;
	}
	if (providerModel.apiMode !== undefined) {
		next.apiMode = providerModel.apiMode;
	} else {
		delete next.apiMode;
	}
	if (providerModel.headers !== undefined) {
		next.headers = providerModel.headers;
	} else {
		delete next.headers;
	}
	return next;
}

export function getMissingProviderSetupMessage(
	model: HFModelItem | undefined,
	models: readonly HFModelItem[],
	providerConfigs: readonly ProviderConfigItem[] = []
): string | undefined {
	if (!model || model.inheritProvider !== true || findProviderTransportModel(models, model.owned_by, providerConfigs)) {
		return undefined;
	}

	const provider = model.owned_by?.trim() || "this provider";
	const modelId = `${model.id}${model.configId ? "::" + model.configId : ""}`;
	return `Provider ${provider} is not configured on this VS Code instance. Model ${modelId} was synced without local Provider Management data. Open OAIProxy Configuration > Provider Management, add provider ${provider}, then save its Base URL, API mode, and API key before using this model.`;
}

export function shouldUseProviderTransport(model: HFModelItem): boolean {
	if (model.inheritProvider === true) {
		return true;
	}
	if (!model.baseUrl && !model.apiMode && model.headers === undefined) {
		return true;
	}
	return isKnownPresetTransport(model);
}

function findLegacyProviderTransportSource(models: readonly HFModelItem[], provider: string): HFModelItem | undefined {
	const normalizedProvider = normalizeProvider(provider);
	return models.find((model) => {
		return (
			!isProviderPlaceholderModel(model) &&
			normalizeProvider(model.owned_by) === normalizedProvider &&
			(model.baseUrl !== undefined || model.apiMode !== undefined || model.headers !== undefined)
		);
	});
}

function isKnownPresetTransport(model: HFModelItem): boolean {
	const matchingPreset = MODEL_PRESETS.find((preset) => {
		return (
			preset.model.id === model.id &&
			(preset.model.configId ?? "") === (model.configId ?? "") &&
			normalizeProvider(preset.model.owned_by) === normalizeProvider(model.owned_by)
		);
	});
	if (!matchingPreset) {
		return false;
	}

	const presetModel = matchingPreset.model;
	return (
		(!model.baseUrl || normalizeUrl(model.baseUrl) === normalizeUrl(presetModel.baseUrl)) &&
		(!model.apiMode || model.apiMode === presetModel.apiMode) &&
		(model.headers === undefined || JSON.stringify(model.headers) === JSON.stringify(presetModel.headers))
	);
}

function normalizeProvider(provider: string | undefined): string {
	return provider?.trim().toLowerCase() ?? "";
}

function normalizeUrl(url: string | undefined): string {
	return url?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
}

function providerConfigToModel(config: ProviderConfigItem): HFModelItem {
	const model: HFModelItem = {
		id: getProviderPlaceholderId(config.provider),
		owned_by: config.provider,
	};
	if (config.baseUrl !== undefined) {
		model.baseUrl = config.baseUrl;
	}
	if (config.apiMode !== undefined) {
		model.apiMode = config.apiMode;
	}
	if (config.headers !== undefined) {
		model.headers = config.headers;
	}
	return model;
}

function isApiMode(value: unknown): value is HFApiMode {
	return (
		value === "openai" ||
		value === "litellm" ||
		value === "openai-responses" ||
		value === "ollama" ||
		value === "anthropic" ||
		value === "gemini"
	);
}

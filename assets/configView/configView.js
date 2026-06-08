const vscode = acquireVsCodeApi();
const state = {
	baseUrl: "",
	apiKey: "",
	delay: 0,
	retry: { enabled: true, max_attempts: 3, interval_ms: 1000, status_codes: [429, 500, 502, 503, 504] },
	commitModel: "",
	models: [],
	providerKeys: {},
	providerUsageKeys: {},
	providerInfo: {},
	providers: [],
	providerPresets: [],
	modelPresets: [],
	providerUsage: {},
	modelFormMode: "quick",
	selectedModelPresetIds: new Set(),
};

// Store the action to be performed after confirmation
const pendingConfirmations = new Map();

// Global Configuration elements
const baseUrlInput = document.getElementById("baseUrl");
const apiKeyInput = document.getElementById("apiKey");
const delayInput = document.getElementById("delay");
const readFileLinesInput = document.getElementById("readFileLines");
const retryEnabledInput = document.getElementById("retryEnabled");
const maxAttemptsInput = document.getElementById("maxAttempts");
const intervalMsInput = document.getElementById("intervalMs");
const statusCodesInput = document.getElementById("statusCodes");

// Provider management elements
const providerTableBody = document.getElementById("providerTableBody");
const providerUsageTableBody = document.getElementById("providerUsageTableBody");
const checkAllProviderUsageBtn = document.getElementById("checkAllProviderUsage");

// Model management elements
const modelTableBody = document.getElementById("modelTableBody");
const modelFormSection = document.getElementById("modelFormSection");
const modelFormTitle = document.getElementById("modelFormTitle");
const addModelModeTabs = document.getElementById("addModelModeTabs");
const quickSetupModeBtn = document.getElementById("quickSetupMode");
const manualSetupModeBtn = document.getElementById("manualSetupMode");
const quickSetupPanel = document.getElementById("quickSetupPanel");
const modelPresetSearchInput = document.getElementById("modelPresetSearch");
const modelPresetProviderFilterInput = document.getElementById("modelPresetProviderFilter");
const modelPresetCategoryFilterInput = document.getElementById("modelPresetCategoryFilter");
const modelPresetList = document.getElementById("modelPresetList");
const selectedPresetSummary = document.getElementById("selectedPresetSummary");
const addSelectedPresetsBtn = document.getElementById("addSelectedPresets");
const removeSelectedPresetsBtn = document.getElementById("removeSelectedPresets");
const clearPresetSelectionBtn = document.getElementById("clearPresetSelection");
const customizePresetBtn = document.getElementById("customizePreset");
const modelDetailsFields = document.getElementById("modelDetailsFields");
const modelIdInput = document.getElementById("modelIdInput");
const modelIdDropdown = document.getElementById("modelIdDropdown");
const modelProviderInput = document.getElementById("modelProvider");
const modelProviderApiKeyInput = document.getElementById("modelProviderApiKey");
const modelDisplayNameInput = document.getElementById("modelDisplayName");
const modelConfigIdInput = document.getElementById("modelConfigId");
const modelBaseUrlInput = document.getElementById("modelBaseUrl");
const modelFamilyInput = document.getElementById("modelFamily");
const modelContextLengthInput = document.getElementById("modelContextLength");
const modelMaxTokensInput = document.getElementById("modelMaxTokens");
const modelVisionInput = document.getElementById("modelVision");
const modelToolCallingInput = document.getElementById("modelToolCalling");
const modelApiModeInput = document.getElementById("modelApiMode");
const modelTemperatureInput = document.getElementById("modelTemperature");
const modelTopPInput = document.getElementById("modelTopP");
const modelDelayInput = document.getElementById("modelDelay");
const modelTopKInput = document.getElementById("modelTopK");
const modelMinPInput = document.getElementById("modelMinP");
const modelFrequencyPenaltyInput = document.getElementById("modelFrequencyPenalty");
const modelPresencePenaltyInput = document.getElementById("modelPresencePenalty");
const modelRepetitionPenaltyInput = document.getElementById("modelRepetitionPenalty");
const modelReasoningEffortInput = document.getElementById("modelReasoningEffort");
const modelEnableThinkingInput = document.getElementById("modelEnableThinking");
const modelThinkingBudgetInput = document.getElementById("modelThinkingBudget");
const modelIncludeReasoningInput = document.getElementById("modelIncludeReasoning");
const modelMaxCompletionTokensInput = document.getElementById("modelMaxCompletionTokens");
const modelReasoningEnabledInput = document.getElementById("modelReasoningEnabled");
const modelReasoningExcludeInput = document.getElementById("modelReasoningExclude");
const modelReasoningEffortORInput = document.getElementById("modelReasoningEffortOR");
const modelReasoningMaxTokensInput = document.getElementById("modelReasoningMaxTokens");
const modelThinkingTypeInput = document.getElementById("modelThinkingType");
const modelSupportsReasoningEffortInput = document.getElementById("modelSupportsReasoningEffort");
const modelSupportedReasoningEffortsInput = document.getElementById("modelSupportedReasoningEfforts");
const modelDefaultReasoningEffortInput = document.getElementById("modelDefaultReasoningEffort");
const modelHeadersInput = document.getElementById("modelHeaders");
const modelExtraInput = document.getElementById("modelExtra");
const modelPromptCacheInput = document.getElementById("modelPromptCache");
const saveModelBtn = document.getElementById("saveModel");
const cancelModelBtn = document.getElementById("cancelModel");
const toggleAdvancedSettingsBtn = document.getElementById("toggleAdvancedSettings");
const commitModelInput = document.getElementById("commitModel");
const commitLanguageInput = document.getElementById("commitLanguage");
const advancedSettingsContent = document.getElementById("advancedSettingsContent");

// Error message element
const modelErrorElement = document.getElementById("modelError");

// Dropdown elements
const dropdownContent = modelIdDropdown.querySelector(".dropdown-content");
const dropdownHeader = modelIdDropdown.querySelector(".dropdown-header");

// Global Configuration save button event listener
document.getElementById("saveBase").addEventListener("click", () => {
	const retry = {
		enabled: retryEnabledInput.checked,
		max_attempts: parseInt(maxAttemptsInput.value) || 3,
		interval_ms: parseInt(intervalMsInput.value) || 1000,
		status_codes: statusCodesInput.value
			? statusCodesInput.value
					.split(",")
					.map((s) => parseInt(s.trim()))
					.filter((n) => !isNaN(n))
			: [],
	};

	vscode.postMessage({
		type: "saveGlobalConfig",
		baseUrl: baseUrlInput.value,
		apiKey: apiKeyInput.value,
		delay: parseInt(delayInput.value) || 0,
		readFileLines: parseInt(readFileLinesInput.value) || 0,
		retry: retry,
		commitModel: commitModelInput.value,
		commitLanguage: commitLanguageInput.value,
	});
});

const handleRefresh = () => {
	// Hide the model form if it's visible
	if (modelFormSection.style.display !== "none") {
		modelFormSection.style.display = "none";
		resetModelForm();
	}
	vscode.postMessage({ type: "requestInit" });
};

// Export and Import buttons event listeners
document.getElementById("exportConfig").addEventListener("click", () => {
	vscode.postMessage({ type: "exportConfig" });
});

document.getElementById("importConfig").addEventListener("click", () => {
	vscode.postMessage({ type: "importConfig" });
});

// Refresh buttons event listeners
document.getElementById("refreshGlobalConfig").addEventListener("click", handleRefresh);
document.getElementById("refreshProviders").addEventListener("click", handleRefresh);
document.getElementById("refreshModels").addEventListener("click", handleRefresh);
checkAllProviderUsageBtn.addEventListener("click", () => {
	const usageTargets = getProviderUsageTargets();
	if (!usageTargets.length) {
		return;
	}

	rememberProviderUsageKeyInputs();
	for (const target of usageTargets) {
		state.providerUsage[target.provider] = {
			status: "loading",
			summary: "Checking usage...",
		};
	}
	renderProviderUsageChecks();
	for (const target of usageTargets) {
		vscode.postMessage({
			type: "checkProviderUsage",
			provider: target.provider,
			usageApiKey: state.providerUsageKeys[target.provider] || undefined,
		});
	}
});

function renderProviderPresetOptions() {
	const options = state.providerPresets
		.map((preset) => `<option value="${preset.id}">${preset.label}</option>`)
		.join("");
	return `<option value="">Custom provider</option>${options}`;
}

function applyProviderPreset(row, presetId) {
	const preset = state.providerPresets.find((item) => item.id === presetId);
	if (!preset) {
		return;
	}

	const providerInput = row.querySelector('[data-field="provider"]');
	const baseUrlInput = row.querySelector('[data-field="baseUrl"]');
	const apiModeInput = row.querySelector('[data-field="apiMode"]');

	providerInput.value = preset.provider;
	baseUrlInput.value = preset.baseUrl;
	apiModeInput.value = preset.apiMode;
}

function getProviderUsageKind(provider, baseUrl) {
	const normalizedProvider = (provider || "").trim().toLowerCase();
	const normalizedBaseUrl = (baseUrl || "").trim().toLowerCase();
	if (normalizedProvider === "openai" || normalizedBaseUrl.includes("api.openai.com")) {
		return "openai";
	}
	if (normalizedProvider === "deepseek" || normalizedBaseUrl.includes("deepseek.com")) {
		return "deepseek";
	}
	if (
		normalizedProvider === "kimi" ||
		normalizedProvider === "moonshot" ||
		normalizedBaseUrl.includes("moonshot.ai") ||
		normalizedBaseUrl.includes("kimi.ai")
	) {
		return "kimi";
	}
	if (
		normalizedProvider === "minimax" ||
		normalizedProvider === "minimax-anthropic" ||
		normalizedBaseUrl.includes("minimax.io")
	) {
		return "minimax";
	}
	if (
		normalizedProvider === "anthropic" ||
		normalizedProvider === "claude" ||
		normalizedBaseUrl.includes("api.anthropic.com")
	) {
		return "anthropic";
	}
	return "";
}

function isMimoProvider(provider, baseUrl) {
	const normalizedProvider = (provider || "").trim().toLowerCase();
	const normalizedBaseUrl = (baseUrl || "").trim().toLowerCase();
	return (
		normalizedProvider === "mimo" ||
		normalizedProvider === "xiaomi" ||
		normalizedProvider === "xiaomi-mimo" ||
		normalizedProvider === "xiaomimimo" ||
		normalizedBaseUrl.includes("xiaomimimo.com")
	);
}

function getProviderUsageUnsupportedReason(provider, baseUrl) {
	if (isMimoProvider(provider, baseUrl)) {
		return "Xiaomi MiMo usage checks are unavailable because Xiaomi only exposes balance/usage through web Console endpoints; no public API-key usage endpoint is documented.";
	}
	return "";
}

function providerUsageNeedsSeparateKey(usageKind) {
	return usageKind === "openai" || usageKind === "anthropic";
}

function getProviderUsagePlan(usageKind) {
	if (usageKind === "deepseek" || usageKind === "kimi") {
		return "Credit";
	}
	if (usageKind === "minimax") {
		return "Token";
	}
	if (usageKind === "openai" || usageKind === "anthropic") {
		return "Cost usage";
	}
	return "";
}

function getProviderUsageTargetDescription(usageKind) {
	if (usageKind === "deepseek" || usageKind === "kimi") {
		return "Remaining credit balance";
	}
	if (usageKind === "minimax") {
		return "Tokens left and reset time";
	}
	if (usageKind === "openai" || usageKind === "anthropic") {
		return "Month-to-date spend";
	}
	return "Not supported";
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function cloneModel(model) {
	return JSON.parse(JSON.stringify(model || {}));
}

function isProviderPlaceholderModel(model) {
	return Boolean(model?.id?.startsWith("__provider__"));
}

function toProviderBackedModel(model) {
	const next = cloneModel(model);
	const providerInfo = state.providerInfo[next.owned_by] || {};
	next.baseUrl = providerInfo.baseUrl || next.baseUrl;
	next.apiMode = providerInfo.apiMode || next.apiMode || "openai";
	if (providerInfo.headers !== undefined) {
		next.headers = providerInfo.headers;
	}
	delete next.inheritProvider;
	return next;
}

function getFullModelId(model) {
	if (!model) {
		return "";
	}
	return `${model.id || ""}${model.configId ? "::" + model.configId : ""}`;
}

function getSelectedModelPresets() {
	return state.modelPresets.filter((preset) => state.selectedModelPresetIds.has(preset.id));
}

function getSelectedModelPreset() {
	const presets = getSelectedModelPresets();
	return presets.length === 1 ? presets[0] : undefined;
}

function hasConfiguredModel(model) {
	return state.models.some((m) => {
		return (
			m.id === model.id &&
			((model.configId && m.configId === model.configId) || (!model.configId && !m.configId))
		);
	});
}

function requiresProviderKey(model) {
	if (!isProviderConfigured(model)) {
		return false;
	}
	const providerTransport = getProviderTransportModel(model.owned_by) || {};
	const apiMode = providerTransport.apiMode || model.apiMode || "openai";
	return Boolean(apiMode !== "ollama" && !state.providerKeys[model.owned_by]);
}

function isProviderConfigured(model) {
	const providerTransport = getProviderTransportModel(model.owned_by) || {};
	return Boolean(providerTransport.baseUrl);
}

function getPresetProviderState(model) {
	if (!isProviderConfigured(model)) {
		return {
			className: "error",
			label: "Provider Needed",
		};
	}
	if (requiresProviderKey(model)) {
		return {
			className: "warning",
			label: "Key Needed",
		};
	}
	return {
		className: "success",
		label: "Provider Ready",
	};
}

function getSelectedPresetBatch() {
	const selectedPresets = getSelectedModelPresets();
	const addPresets = selectedPresets.filter((preset) => !hasConfiguredModel(preset.model));
	const removePresets = selectedPresets.filter((preset) => hasConfiguredModel(preset.model));
	const missingSetupProviders = Array.from(
		new Set(addPresets.filter((preset) => !isProviderConfigured(preset.model)).map((preset) => preset.model.owned_by))
	).sort((a, b) => getProviderLabel(a).localeCompare(getProviderLabel(b)));
	const missingProviders = Array.from(
		new Set(addPresets.filter((preset) => requiresProviderKey(preset.model)).map((preset) => preset.model.owned_by))
	).sort((a, b) => getProviderLabel(a).localeCompare(getProviderLabel(b)));

	return {
		selectedPresets,
		addPresets,
		removePresets,
		missingSetupProviders,
		missingProviders,
	};
}

function showQuickSetupProviderBlocker(batch) {
	if (!batch.missingSetupProviders.length && !batch.missingProviders.length) {
		return false;
	}

	const details = [];
	if (batch.missingSetupProviders.length) {
		details.push(
			`provider setup is missing for ${batch.missingSetupProviders.map((provider) => getProviderLabel(provider)).join(", ")}`
		);
	}
	if (batch.missingProviders.length) {
		details.push(`API key is not saved for ${batch.missingProviders.map((provider) => getProviderLabel(provider)).join(", ")}`);
	}

	const confirmId = "quickSetupProviderReminder_" + Date.now();
	pendingConfirmations.set(confirmId, { action: () => {} });
	vscode.postMessage({
		type: "requestConfirm",
		id: confirmId,
		message: `Cannot add selected model(s): ${details.join("; ")}. Open OAIProxy Configuration > Provider Management and add the provider base URL/API mode/API key, or use the provider API key command, then try Add Selected again.`,
		action: "showInfo",
	});
	return true;
}

function clearModelPresetSelection() {
	state.selectedModelPresetIds.clear();
	renderModelPresets();
}

function requestDeleteModel(modelId) {
	const confirmId = "deleteModel_" + Date.now();

	pendingConfirmations.set(confirmId, {
		action: () => vscode.postMessage({ type: "deleteModel", modelId: modelId }),
	});

	vscode.postMessage({
		type: "requestConfirm",
		id: confirmId,
		message: `Are you sure you want to delete model ${modelId}?`,
		action: "deleteModel",
	});
}

function requestDeleteModels(modelIds) {
	const confirmId = "deleteModels_" + Date.now();

	pendingConfirmations.set(confirmId, {
		action: () => {
			vscode.postMessage({ type: "deleteModels", modelIds: modelIds });
			state.selectedModelPresetIds.clear();
			renderModelPresets();
		},
	});

	vscode.postMessage({
		type: "requestConfirm",
		id: confirmId,
		message: `Remove ${modelIds.length} selected configured model(s)?`,
		action: "deleteModels",
	});
}

function getProviderLabel(provider) {
	const preset = state.providerPresets.find((item) => item.provider === provider);
	return preset ? preset.label : provider;
}

function getProviderTransportModel(provider) {
	const normalizedProvider = (provider || "").trim().toLowerCase();
	if (!normalizedProvider) {
		return undefined;
	}
	const providerConfig = state.providers.find((item) => (item.provider || "").trim().toLowerCase() === normalizedProvider);
	if (providerConfig) {
		return {
			id: `__provider__${providerConfig.provider}`,
			owned_by: providerConfig.provider,
			baseUrl: providerConfig.baseUrl,
			apiMode: providerConfig.apiMode,
			headers: providerConfig.headers,
		};
	}
	const providerModels = state.models.filter((m) => (m.owned_by || "").trim().toLowerCase() === normalizedProvider);
	return (
		providerModels.find((model) => isProviderPlaceholderModel(model)) ||
		providerModels.find((model) => model.baseUrl || model.apiMode || model.headers)
	);
}

function getKnownProviderEntries(configuredProviders) {
	const entries = new Map();

	for (const providerEntry of configuredProviders) {
		const provider = providerEntry.provider;
		const transportModel = getProviderTransportModel(provider) || {};
		entries.set(provider, {
			provider,
			label: getProviderLabel(provider),
			baseUrl: transportModel.baseUrl || providerEntry.baseUrl || state.baseUrl,
			apiMode: transportModel.apiMode || providerEntry.apiMode || "openai",
			headers: transportModel.headers ?? providerEntry.headers,
		});
	}

	for (const preset of state.providerPresets) {
		if (!entries.has(preset.provider)) {
			entries.set(preset.provider, {
				provider: preset.provider,
				label: preset.label,
				baseUrl: preset.baseUrl || state.baseUrl,
				apiMode: preset.apiMode || "openai",
				headers: undefined,
			});
		}
	}

	for (const preset of state.modelPresets) {
		const model = preset.model || {};
		const provider = model.owned_by;
		if (provider && !entries.has(provider)) {
			entries.set(provider, {
				provider,
				label: getProviderLabel(provider),
				baseUrl: model.baseUrl || state.baseUrl,
				apiMode: model.apiMode || "openai",
				headers: model.headers,
			});
		}
	}

	return Array.from(entries.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function syncModelProviderOptions(configuredProviders) {
	const entries = getKnownProviderEntries(configuredProviders);
	state.providerInfo = {};
	const providerOptions = entries
		.map((entry) => {
			state.providerInfo[entry.provider] = {
				baseUrl: entry.baseUrl || state.baseUrl,
				apiMode: entry.apiMode || "openai",
				apiKey: state.providerKeys[entry.provider] || state.apiKey,
				headers: entry.headers,
			};
			return `<option value="${escapeHtml(entry.provider)}">${escapeHtml(entry.label)}</option>`;
		})
		.join("");
	modelProviderInput.innerHTML = '<option value="">Select Provider</option>' + providerOptions;
}

function updateModelProviderKeyPlaceholder() {
	const provider = modelProviderInput.value;
	const hasProviderKey = Boolean(state.providerKeys[provider]);
	if (hasProviderKey) {
		modelProviderApiKeyInput.placeholder = "Saved - leave blank to keep";
		return;
	}
	if (modelApiModeInput.value === "ollama") {
		modelProviderApiKeyInput.placeholder = "Optional; defaults to ollama";
		return;
	}
	modelProviderApiKeyInput.placeholder = "Enter provider API key";
}

function getConfiguredProviders() {
	const providers = new Map();
	for (const providerConfig of state.providers) {
		const provider = providerConfig.provider;
		if (!provider) {
			continue;
		}
		providers.set(provider, {
			provider,
			baseUrl: providerConfig.baseUrl || "",
			apiMode: providerConfig.apiMode || "",
			headers: providerConfig.headers,
			modelCount: 0,
			modelIds: [],
		});
	}
	for (const model of state.models) {
		const provider = model.owned_by;
		if (!provider) {
			continue;
		}
		const current = providers.get(provider) || {
			provider,
			baseUrl: model.baseUrl || "",
			apiMode: model.apiMode || "",
			headers: model.headers,
			modelCount: 0,
			modelIds: [],
		};
		if (isProviderPlaceholderModel(model)) {
			current.baseUrl = model.baseUrl || "";
			current.apiMode = model.apiMode || "";
			current.headers = model.headers;
		} else if (!current.baseUrl && model.baseUrl) {
			current.baseUrl = model.baseUrl;
		}
		if (!isProviderPlaceholderModel(model)) {
			current.modelCount += 1;
			current.modelIds.push(model.displayName || model.id);
		}
		providers.set(provider, current);
	}
	return Array.from(providers.values()).sort((a, b) => a.provider.localeCompare(b.provider));
}

function formatModelList(entry) {
	if (!entry.modelIds.length) {
		return "provider only";
	}
	const visible = entry.modelIds.slice(0, 2).join(", ");
	const remaining = entry.modelIds.length - 2;
	return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

function getProviderUsageTargets() {
	return getProviderUsageRows().filter((entry) => entry.usageKind);
}

function getProviderUsageRows() {
	return getConfiguredProviders()
		.map((entry) => ({
			...entry,
			usageKind: getProviderUsageKind(entry.provider, entry.baseUrl),
			unsupportedReason: getProviderUsageUnsupportedReason(entry.provider, entry.baseUrl),
		}))
		.filter((entry) => entry.usageKind || entry.unsupportedReason);
}

function rememberProviderUsageKeyInputs() {
	document.querySelectorAll(".provider-usage-key-input").forEach((input) => {
		const provider = input.getAttribute("data-provider");
		if (provider) {
			state.providerUsageKeys[provider] = input.value;
		}
	});
}

function renderProviderUsageStatus(usageState, unsupportedReason) {
	if (unsupportedReason) {
		return '<span class="status-pill idle">Unavailable</span>';
	}
	if (!usageState || !usageState.status) {
		return '<span class="status-pill idle">Not checked</span>';
	}
	if (usageState.status === "loading") {
		return '<span class="status-pill loading">Checking</span>';
	}
	if (usageState.status === "error") {
		return '<span class="status-pill error">Error</span>';
	}
	return '<span class="status-pill success">Checked</span>';
}

function renderProviderUsageValue(usageState, usageKind, unsupportedReason) {
	if (unsupportedReason) {
		return `<div class="usage-value muted">${escapeHtml(unsupportedReason)}</div>`;
	}
	if (usageState?.status === "success") {
		return `<div class="usage-value">${escapeHtml(usageState.summary || "Usage check completed.")}</div>`;
	}
	if (usageState?.status === "error") {
		return `<div class="usage-value error-text">${escapeHtml(usageState.error || "Usage check failed.")}</div>`;
	}
	return `<div class="usage-value muted">${escapeHtml(getProviderUsageTargetDescription(usageKind))}</div>`;
}

function renderProviderUsageKeyCell(provider, usageKind, unsupportedReason) {
	if (unsupportedReason) {
		return '<div class="usage-key-note">Not used</div>';
	}
	if (providerUsageNeedsSeparateKey(usageKind)) {
		return `<input type="password" class="provider-input provider-usage-key-input" data-provider="${escapeHtml(
			provider
		)}" value="${escapeHtml(state.providerUsageKeys[provider] || "")}" placeholder="Admin usage key" />`;
	}
	return '<div class="usage-key-note">Provider API key</div>';
}

function renderProviderUsageChecks() {
	const rows = getProviderUsageRows();
	const supportedTargets = rows.filter((target) => target.usageKind);
	checkAllProviderUsageBtn.disabled =
		supportedTargets.length === 0 || supportedTargets.some((target) => state.providerUsage[target.provider]?.status === "loading");
	if (!rows.length) {
		providerUsageTableBody.innerHTML =
			'<tr><td colspan="6" class="no-data">No configured providers have known usage-check behavior yet</td></tr>';
		return;
	}

	providerUsageTableBody.innerHTML = rows
		.map((target) => {
			const providerAttr = escapeHtml(target.provider);
			const usageState = state.providerUsage[target.provider] || {};
			const isLoading = usageState.status === "loading";
			const isUnsupported = Boolean(target.unsupportedReason);
			return `
				<tr data-provider="${providerAttr}">
					<td class="provider-id-cell">
						<div class="provider-name">${providerAttr}</div>
						<div class="provider-meta">${escapeHtml(formatModelList(target))}</div>
					</td>
					<td>
						<div class="usage-plan">${escapeHtml(isUnsupported ? "Unavailable" : getProviderUsagePlan(target.usageKind))}</div>
						<div class="provider-meta">${escapeHtml(target.usageKind || "mimo")}</div>
					</td>
					<td>${renderProviderUsageValue(usageState, target.usageKind, target.unsupportedReason)}</td>
					<td>${renderProviderUsageKeyCell(target.provider, target.usageKind, target.unsupportedReason)}</td>
					<td>${renderProviderUsageStatus(usageState, target.unsupportedReason)}</td>
					<td class="action-cell">
						<div class="action-buttons">
							${
								isUnsupported
									? '<span class="usage-key-note">No API endpoint</span>'
									: `<button class="check-provider-usage-btn compact" data-provider="${providerAttr}" ${isLoading ? "disabled" : ""}>${
											isLoading ? "Checking..." : "Check"
										}</button>`
							}
						</div>
					</td>
				</tr>`;
		})
		.join("");

	document.querySelectorAll(".check-provider-usage-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			const provider = event.target.getAttribute("data-provider");
			if (!provider) {
				return;
			}
			rememberProviderUsageKeyInputs();
			state.providerUsage[provider] = {
				status: "loading",
				summary: "Checking usage...",
			};
			renderProviderUsageChecks();
			vscode.postMessage({
				type: "checkProviderUsage",
				provider: provider,
				usageApiKey: state.providerUsageKeys[provider] || undefined,
			});
		});
	});
}

function formatPresetCategory(value) {
	if (!value) {
		return "";
	}
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function getModelOutputLimit(model) {
	return model.max_tokens ?? model.max_completion_tokens ?? "";
}

function renderModelPresetFilters() {
	const currentProvider = modelPresetProviderFilterInput.value;
	const providers = Array.from(new Set(state.modelPresets.map((preset) => preset.model?.owned_by).filter(Boolean))).sort(
		(a, b) => getProviderLabel(a).localeCompare(getProviderLabel(b))
	);
	modelPresetProviderFilterInput.innerHTML =
		'<option value="">All providers</option>' +
		providers
			.map((provider) => `<option value="${escapeHtml(provider)}">${escapeHtml(getProviderLabel(provider))}</option>`)
			.join("");
	if (providers.includes(currentProvider)) {
		modelPresetProviderFilterInput.value = currentProvider;
	}
}

function renderSelectedPresetSummary() {
	const batch = getSelectedPresetBatch();
	if (!batch.selectedPresets.length) {
		selectedPresetSummary.classList.add("muted");
		selectedPresetSummary.innerHTML = "Select one or more presets to add or remove configured models.";
		addSelectedPresetsBtn.disabled = true;
		removeSelectedPresetsBtn.disabled = true;
		clearPresetSelectionBtn.disabled = true;
		customizePresetBtn.disabled = true;
		return;
	}

	const singlePreset = getSelectedModelPreset();
	const missingSetupProviderText = batch.missingSetupProviders.map((provider) => getProviderLabel(provider)).join(", ");
	const missingProviderText = batch.missingProviders.map((provider) => getProviderLabel(provider)).join(", ");
	selectedPresetSummary.classList.remove("muted");
	const detailHtml = singlePreset
		? (() => {
				const model = singlePreset.model;
				const providerInfo = state.providerInfo[model.owned_by] || {};
				const apiMode = providerInfo.apiMode || model.apiMode || "openai";
				const hasKey = Boolean(state.providerKeys[model.owned_by]) || apiMode === "ollama";
				const outputField = model.max_completion_tokens !== undefined ? "max_completion_tokens" : "max_tokens";
				return `
					<div class="selected-preset-title">${escapeHtml(singlePreset.label)}</div>
					<div class="selected-preset-grid">
						<span>Provider: ${escapeHtml(getProviderLabel(model.owned_by))}</span>
						<span>API: ${escapeHtml(apiMode)} inherited</span>
						<span>Context: ${escapeHtml(model.context_length || "")}</span>
						<span>${escapeHtml(outputField)}: ${escapeHtml(getModelOutputLimit(model))}</span>
						<span>Key: ${hasKey ? "Saved/optional" : "Not saved"}</span>
					</div>
				`;
			})()
		: "";
	selectedPresetSummary.innerHTML = `
		<div class="selected-preset-title">${batch.selectedPresets.length} preset(s) selected</div>
		<div class="selected-preset-grid">
			<span>Add ready: ${batch.addPresets.length}</span>
			<span>Remove ready: ${batch.removePresets.length}</span>
			<span>Providers needed: ${batch.missingSetupProviders.length ? escapeHtml(missingSetupProviderText) : "None"}</span>
			<span>Keys not saved: ${batch.missingProviders.length ? escapeHtml(missingProviderText) : "None"}</span>
		</div>
		${detailHtml}
	`;
	addSelectedPresetsBtn.disabled = batch.addPresets.length === 0;
	removeSelectedPresetsBtn.disabled = batch.removePresets.length === 0;
	clearPresetSelectionBtn.disabled = false;
	customizePresetBtn.disabled = batch.selectedPresets.length !== 1;
}

function renderModelPresets() {
	const search = modelPresetSearchInput.value.trim().toLowerCase();
	const providerFilter = modelPresetProviderFilterInput.value;
	const categoryFilter = modelPresetCategoryFilterInput.value;
	const presets = state.modelPresets
		.filter((preset) => {
			const model = preset.model || {};
			if (providerFilter && model.owned_by !== providerFilter) {
				return false;
			}
			if (categoryFilter && preset.category !== categoryFilter) {
				return false;
			}
			if (!search) {
				return true;
			}
			const haystack = [
				preset.label,
				preset.description,
				preset.category,
				model.id,
				model.displayName,
				model.owned_by,
				model.apiMode,
				...(preset.tags || []),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(search);
		})
		.sort((a, b) => {
			const providerCompare = getProviderLabel(a.model.owned_by).localeCompare(getProviderLabel(b.model.owned_by));
			return providerCompare || a.label.localeCompare(b.label);
		});

	if (!presets.length) {
		modelPresetList.innerHTML = '<div class="no-data">No matching model presets</div>';
		renderSelectedPresetSummary();
		return;
	}

	modelPresetList.innerHTML = presets
		.map((preset) => {
			const model = preset.model || {};
			const providerInfo = state.providerInfo[model.owned_by] || {};
			const apiMode = providerInfo.apiMode || model.apiMode || "openai";
			const selected = state.selectedModelPresetIds.has(preset.id);
			const configured = hasConfiguredModel(model);
			const providerState = getPresetProviderState(model);
			const fullModelId = getFullModelId(model);
			const tags = [formatPresetCategory(preset.category), ...(preset.tags || [])].filter(Boolean);
			return `
				<div class="preset-card ${selected ? "selected" : ""}" tabindex="0" data-preset-id="${escapeHtml(preset.id)}">
					<div class="preset-card-top">
						<label class="preset-card-check">
							<input type="checkbox" class="preset-select-checkbox" data-preset-id="${escapeHtml(preset.id)}" ${selected ? "checked" : ""} />
							<span class="preset-title">${escapeHtml(preset.label)}</span>
						</label>
						<div class="preset-card-state">
							<span class="status-pill ${configured ? "success" : providerState.className}">${
								configured ? "Configured" : providerState.label
							}</span>
							${
								configured
									? `<button type="button" class="remove-preset-model-btn danger compact" data-model-id="${escapeHtml(fullModelId)}">Remove</button>`
									: ""
							}
						</div>
					</div>
					<div class="preset-model-id">${escapeHtml(fullModelId)}</div>
					<div class="preset-description">${escapeHtml(preset.description)}</div>
					<div class="preset-meta">
						<span>${escapeHtml(getProviderLabel(model.owned_by))}</span>
						<span>${escapeHtml(apiMode)}</span>
						<span>${escapeHtml(model.context_length || "")} ctx</span>
						<span>${escapeHtml(getModelOutputLimit(model))} out</span>
					</div>
					<div class="preset-tags">
						${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
					</div>
				</div>
			`;
		})
		.join("");

	modelPresetList.querySelectorAll(".preset-card").forEach((card) => {
		card.addEventListener("click", (event) => {
			if (event.target.closest(".remove-preset-model-btn") || event.target.closest(".preset-card-check")) {
				return;
			}
			toggleModelPresetSelection(card.getAttribute("data-preset-id"));
		});
		card.addEventListener("keydown", (event) => {
			if (event.target.closest(".remove-preset-model-btn") || event.target.closest(".preset-card-check")) {
				return;
			}
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}
			event.preventDefault();
			toggleModelPresetSelection(card.getAttribute("data-preset-id"));
		});
	});
	modelPresetList.querySelectorAll(".preset-select-checkbox").forEach((checkbox) => {
		checkbox.addEventListener("change", (event) => {
			toggleModelPresetSelection(event.currentTarget.getAttribute("data-preset-id"));
		});
	});
	modelPresetList.querySelectorAll(".remove-preset-model-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			event.stopPropagation();
			requestDeleteModel(event.currentTarget.getAttribute("data-model-id"));
		});
	});
	renderSelectedPresetSummary();
}

function ensureProviderOption(provider) {
	if (!provider) {
		return;
	}
	const providerExists = Array.from(modelProviderInput.options).some((option) => option.value === provider);
	if (providerExists) {
		return;
	}
	const newOption = document.createElement("option");
	newOption.value = provider;
	newOption.textContent = provider;
	modelProviderInput.appendChild(newOption);
}

function setJsonInput(input, value) {
	input.value = value ? JSON.stringify(value, null, 2) : "";
}

function setOptionalBooleanInput(input, value) {
	input.value = value !== undefined ? String(value) : "";
}

function setOptionalNumberInput(input, value) {
	input.value = value !== undefined && value !== null ? value : "";
}

function applyModelToForm(model) {
	const currentProvider = model.owned_by || "";
	ensureProviderOption(currentProvider);
	const providerInfo = state.providerInfo[currentProvider] || {};

	modelIdInput.value = model.id || "";
	modelProviderInput.value = currentProvider;
	modelProviderApiKeyInput.value = "";
	modelDisplayNameInput.value = model.displayName || "";
	modelConfigIdInput.value = model.configId || "";
	modelBaseUrlInput.value = providerInfo.baseUrl || model.baseUrl || "";
	modelFamilyInput.value = model.family || "";
	setOptionalNumberInput(modelContextLengthInput, model.context_length);
	setOptionalNumberInput(modelMaxTokensInput, model.max_tokens);
	setOptionalNumberInput(modelMaxCompletionTokensInput, model.max_completion_tokens);
	setOptionalBooleanInput(modelVisionInput, model.vision);
	setOptionalBooleanInput(modelToolCallingInput, model.toolCalling);
	modelApiModeInput.value = providerInfo.apiMode || model.apiMode || "openai";
	setOptionalNumberInput(modelTemperatureInput, model.temperature);
	setOptionalNumberInput(modelTopPInput, model.top_p);
	setOptionalNumberInput(modelDelayInput, model.delay);
	setOptionalNumberInput(modelTopKInput, model.top_k);
	setOptionalNumberInput(modelMinPInput, model.min_p);
	setOptionalNumberInput(modelFrequencyPenaltyInput, model.frequency_penalty);
	setOptionalNumberInput(modelPresencePenaltyInput, model.presence_penalty);
	setOptionalNumberInput(modelRepetitionPenaltyInput, model.repetition_penalty);
	modelReasoningEffortInput.value = model.reasoning_effort || "";
	setOptionalBooleanInput(modelEnableThinkingInput, model.enable_thinking);
	setOptionalNumberInput(modelThinkingBudgetInput, model.thinking_budget);
	setOptionalBooleanInput(modelIncludeReasoningInput, model.include_reasoning_in_request);
	setOptionalBooleanInput(modelSupportsReasoningEffortInput, model.supports_reasoning_effort);
	modelSupportedReasoningEffortsInput.value = Array.isArray(model.supported_reasoning_efforts)
		? model.supported_reasoning_efforts.join(",")
		: "";
	modelDefaultReasoningEffortInput.value = model.default_reasoning_effort || "";

	if (model.reasoning) {
		setOptionalBooleanInput(modelReasoningEnabledInput, model.reasoning.enabled);
		modelReasoningEffortORInput.value = model.reasoning.effort || "";
		setOptionalBooleanInput(modelReasoningExcludeInput, model.reasoning.exclude);
		setOptionalNumberInput(modelReasoningMaxTokensInput, model.reasoning.max_tokens);
	} else {
		modelReasoningEnabledInput.value = "";
		modelReasoningEffortORInput.value = "";
		modelReasoningExcludeInput.value = "";
		modelReasoningMaxTokensInput.value = "";
	}

	modelThinkingTypeInput.value = model.thinking?.type || "";
	setJsonInput(modelHeadersInput, providerInfo.headers ?? model.headers);
	setJsonInput(modelExtraInput, model.extra);
	setJsonInput(modelPromptCacheInput, model.prompt_cache);
	updateModelProviderKeyPlaceholder();
}

function toggleModelPresetSelection(presetId) {
	const preset = state.modelPresets.find((item) => item.id === presetId);
	if (!preset) {
		return;
	}
	if (state.selectedModelPresetIds.has(preset.id)) {
		state.selectedModelPresetIds.delete(preset.id);
	} else {
		state.selectedModelPresetIds.add(preset.id);
	}
	showModelError("");
	renderModelPresets();
}

function setModelFormMode(mode) {
	state.modelFormMode = mode;
	const isQuick = mode === "quick";
	const isCustomize = mode === "customize";
	const isEdit = mode === "edit";

	addModelModeTabs.style.display = isEdit ? "none" : "flex";
	quickSetupPanel.style.display = isQuick || isCustomize ? "block" : "none";
	modelDetailsFields.style.display = isQuick ? "none" : "block";
	saveModelBtn.style.display = isQuick ? "none" : "";
	cancelModelBtn.textContent = isQuick ? "Close" : "Cancel";
	quickSetupModeBtn.classList.toggle("active", isQuick || isCustomize);
	manualSetupModeBtn.classList.toggle("active", mode === "manual");

	if (mode === "manual") {
		state.selectedModelPresetIds.clear();
		modelBaseUrlInput.disabled = false;
		modelApiModeInput.disabled = false;
		modelHeadersInput.disabled = false;
		renderModelPresets();
		return;
	}

	if (mode === "customize") {
		modelBaseUrlInput.disabled = true;
		modelApiModeInput.disabled = true;
		modelHeadersInput.disabled = true;
		return;
	}

	modelBaseUrlInput.disabled = !isEdit;
	modelApiModeInput.disabled = !isEdit;
	modelHeadersInput.disabled = false;
	if (isEdit) {
		modelBaseUrlInput.disabled = true;
		modelApiModeInput.disabled = true;
		modelHeadersInput.disabled = getOriginalEditingModel().inheritProvider === true;
	}
}

function collectProviderRowData(row) {
	const inputs = row.querySelectorAll(".provider-input");
	const providerData = {};
	inputs.forEach((input) => {
		const field = input.getAttribute("data-field");
		providerData[field] = input.value;
	});

	let headers = undefined;
	if (providerData.headers && providerData.headers.trim()) {
		try {
			headers = JSON.parse(providerData.headers);
		} catch (e) {
			// ignore invalid JSON
		}
	}

	return { providerData, headers };
}

// Add Provider button event listener
document.getElementById("addProvider").addEventListener("click", () => {
	// Add new provider row to the table
	const newRow = document.createElement("tr");
	newRow.innerHTML = `
		<td>
			<select class="provider-preset-select" aria-label="Provider preset">
				${renderProviderPresetOptions()}
			</select>
			<input type="text" class="provider-input" data-field="provider" placeholder="Provider ID" />
		</td>
		<td><input type="text" class="provider-input" data-field="baseUrl" placeholder="Base URL" /></td>
		<td><input type="password" class="provider-input" data-field="apiKey" placeholder="API Key" /></td>
		<td>
			<select class="provider-input" data-field="apiMode">
				<option value="openai">OpenAI</option>
				<option value="openai-responses">OpenAI Responses</option>
				<option value="ollama">Ollama</option>
				<option value="anthropic">Anthropic</option>
				<option value="gemini">Gemini</option>
			</select>
		</td>
		<td><textarea class="provider-input" data-field="headers" rows="2" placeholder='{"X-API-Version": "v1"}' style="width: 100%; font-family: monospace; font-size: 12px;"></textarea></td>
		<td class="action-cell">
			<div class="action-buttons">
				<button class="save-provider-btn secondary">Save</button>
				<button class="cancel-provider-btn secondary">Cancel</button>
			</div>
		</td>
	`;
	providerTableBody.appendChild(newRow);

	// Add event listeners for the new row
	const saveBtn = newRow.querySelector(".save-provider-btn");
	const cancelBtn = newRow.querySelector(".cancel-provider-btn");
	const presetSelect = newRow.querySelector(".provider-preset-select");

	presetSelect.addEventListener("change", () => {
		applyProviderPreset(newRow, presetSelect.value);
	});

	saveBtn.addEventListener("click", () => {
		const { providerData, headers } = collectProviderRowData(newRow);

		vscode.postMessage({
			type: "addProvider",
			provider: providerData.provider,
			baseUrl: providerData.baseUrl || undefined,
			apiKey: providerData.apiKey || undefined,
			apiMode: providerData.apiMode || undefined,
			headers: headers,
		});

		newRow.remove();
	});

	cancelBtn.addEventListener("click", () => {
		newRow.remove();
	});
});

// Add Model button event listeners
document.getElementById("addModel").addEventListener("click", () => {
	// Show the model form
	modelFormSection.style.display = "block";
	modelFormTitle.textContent = "Add Model";
	// Reset form
	resetModelForm();
	setModelFormMode("quick");
	renderModelPresetFilters();
	renderModelPresets();
});

quickSetupModeBtn.addEventListener("click", () => {
	resetModelForm();
	setModelFormMode("quick");
	renderModelPresets();
});

manualSetupModeBtn.addEventListener("click", () => {
	resetModelForm();
	setModelFormMode("manual");
});

addSelectedPresetsBtn.addEventListener("click", () => {
	const batch = getSelectedPresetBatch();
	if (!batch.addPresets.length) {
		showModelError("No selected unconfigured presets to add.");
		return;
	}
	if (showQuickSetupProviderBlocker(batch)) {
		return;
	}

	vscode.postMessage({
		type: "addModels",
		models: batch.addPresets.map((preset) => toProviderBackedModel(preset.model)),
	});
	state.selectedModelPresetIds.clear();
	renderModelPresets();
});

removeSelectedPresetsBtn.addEventListener("click", () => {
	const batch = getSelectedPresetBatch();
	if (!batch.removePresets.length) {
		showModelError("No selected configured presets to remove.");
		return;
	}

	requestDeleteModels(batch.removePresets.map((preset) => getFullModelId(preset.model)));
});

clearPresetSelectionBtn.addEventListener("click", () => {
	clearModelPresetSelection();
});

customizePresetBtn.addEventListener("click", () => {
	const preset = getSelectedModelPreset();
	if (!preset) {
		return;
	}
	applyModelToForm(cloneModel(preset.model));
	setModelFormMode("customize");
	advancedSettingsContent.style.display = "block";
	toggleAdvancedSettingsBtn.textContent = "Hide Advanced Settings";
});

modelPresetSearchInput.addEventListener("input", renderModelPresets);
modelPresetProviderFilterInput.addEventListener("change", renderModelPresets);
modelPresetCategoryFilterInput.addEventListener("change", renderModelPresets);

// Provider dropdown change event listener for auto-fill
modelProviderInput.addEventListener("change", () => {
	const selectedProvider = modelProviderInput.value;
	if (selectedProvider && state.providerInfo[selectedProvider]) {
		// Auto-fill BaseURL and apiMode from provider info
		modelBaseUrlInput.value = state.providerInfo[selectedProvider].baseUrl;
		modelApiModeInput.value = state.providerInfo[selectedProvider].apiMode;

		// Use headers from provider info
		const headers = state.providerInfo[selectedProvider].headers;
		modelHeadersInput.value = headers ? JSON.stringify(headers, null, 2) : "";

		// Request to fetch remote models for the selected provider
		vscode.postMessage({
			type: "fetchModels",
			baseUrl: state.providerInfo[selectedProvider].baseUrl || state.baseUrl,
			apiKey: state.providerKeys[selectedProvider] || state.apiKey,
			apiMode: state.providerInfo[selectedProvider].apiMode || modelApiModeInput.value || "openai",
			headers,
		});
	}
	updateModelProviderKeyPlaceholder();
});

modelApiModeInput.addEventListener("change", updateModelProviderKeyPlaceholder);

// Toggle advanced settings
toggleAdvancedSettingsBtn.addEventListener("click", () => {
	const isCurrentlyVisible = advancedSettingsContent.style.display !== "none";
	advancedSettingsContent.style.display = isCurrentlyVisible ? "none" : "block";
	toggleAdvancedSettingsBtn.textContent = isCurrentlyVisible ? "Show Advanced Settings" : "Hide Advanced Settings";
});

// Save Model button event listener
saveModelBtn.addEventListener("click", () => {
	const modelData = collectModelFormData();
	if (!validateModelData(modelData)) {
		return;
	}
	const providerApiKey = collectModelProviderApiKey(modelData);
	const inheritProvider = modelData.inheritProvider === true;

	// For updates, ensure the model ID remains unchanged
	const isEditing = modelIdInput.hasAttribute("data-editing");
	if (isEditing) {
		// Remove helper attributes from the model data before sending
		let originalModelId = modelData.originalModelId;
		let originalConfigId = modelData.originalConfigId;
		delete modelData.originalModelId;
		delete modelData.originalConfigId;

		vscode.postMessage({
			type: "updateModel",
			model: modelData,
			originalModelId: originalModelId,
			originalConfigId: originalConfigId,
			providerApiKey,
			inheritProvider,
		});
	} else {
		vscode.postMessage({
			type: "addModel",
			model: modelData,
			providerApiKey,
			inheritProvider,
		});
	}

	// Hide the form and reset it
	modelFormSection.style.display = "none";
	resetModelForm();
});

// Cancel Model button event listener
cancelModelBtn.addEventListener("click", () => {
	// Hide the form and reset it
	modelFormSection.style.display = "none";
	resetModelForm();
});

window.addEventListener("message", (event) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			const {
				baseUrl,
				apiKey,
				delay,
				readFileLines,
				retry,
				commitModel,
				models,
				providers,
				providerKeys,
				providerUsageKeys,
				providerPresets,
				modelPresets,
				commitLanguage,
			} = message.payload;
			state.baseUrl = baseUrl;
			state.apiKey = apiKey;
			state.delay = delay || 0;
			state.readFileLines = readFileLines || 0;
			state.retry = retry || {
				enabled: true,
				max_attempts: 3,
				interval_ms: 1000,
				status_codes: [],
			};
			state.models = models || [];
			state.providers = providers || [];
			state.commitModel = commitModel || "";
			state.providerKeys = providerKeys || {};
			state.providerUsageKeys = providerUsageKeys || {};
			state.providerPresets = providerPresets || [];
			state.modelPresets = modelPresets || [];

			// Update base configuration
			baseUrlInput.value = baseUrl || "";
			apiKeyInput.value = apiKey || "";
			delayInput.value = state.delay;
			readFileLinesInput.value = message.payload.readFileLines || 0;
			retryEnabledInput.checked = state.retry.enabled !== false;
			maxAttemptsInput.value = state.retry.max_attempts || 3;
			intervalMsInput.value = state.retry.interval_ms || 1000;
			statusCodesInput.value = state.retry.status_codes ? state.retry.status_codes.join(",") : "";

			// Populate commit model dropdown and select current commit model
			populateCommitModelDropdown();
			commitModelInput.value = state.commitModel || "";
			commitLanguageInput.value = commitLanguage;

			// Render provider and model management
			renderProviders();
			renderModelPresetFilters();
			renderModelPresets();
			renderModels();
			renderProviderUsageChecks();
			break;
		case "modelsFetched":
			// Handle the response from fetchModels
			populateModelIdDropdown(message.models);
			break;
		case "modelsFetchError":
			// Handle error from fetchModels
			dropdownHeader.textContent = "Error fetching models";
			dropdownContent.innerHTML = `<div class="dropdown-option error">Failed to fetch models. Check the Developer Console for details.</div>`;
			console.error("[oaiproxy] Failed to fetch models:", message.error);
			break;
		case "providerUsageResult":
			state.providerUsage[message.provider] = {
				status: "success",
				summary: message.result.summary,
			};
			renderProviderUsageChecks();
			break;
		case "providerUsageError":
			state.providerUsage[message.provider] = {
				status: "error",
				error: message.error,
			};
			renderProviderUsageChecks();
			break;
		case "confirmResponse":
			// Handle confirmation responses
			const pendingAction = pendingConfirmations.get(message.id);
			if (pendingAction && message.confirmed) {
				if (pendingAction.action) {
					pendingAction.action();
				}
				// Clean up the pending confirmation
				pendingConfirmations.delete(message.id);
			} else if (pendingAction) {
				// Clean up the pending confirmation even if not confirmed
				pendingConfirmations.delete(message.id);
			}
			break;
	}
});

function renderProviders() {
	const providers = getConfiguredProviders();
	syncModelProviderOptions(providers);

	if (!providers.length) {
		providerTableBody.innerHTML = '<tr><td colspan="6" class="no-data">No providers</td></tr>';
		return;
	}

	const rows = providers
		.map((providerEntry) => {
			const provider = providerEntry.provider;
			const providerConfig = getProviderTransportModel(provider) || providerEntry;
			const apiMode = providerConfig.apiMode || "openai";
			const baseUrl = providerConfig.baseUrl || "";
			const headersJson = providerConfig.headers ? JSON.stringify(providerConfig.headers, null, 2) : "";
			const providerAttr = escapeHtml(provider);
			const hasProviderKey = Boolean(state.providerKeys[provider]);
			const keyPlaceholder = hasProviderKey ? "Saved - leave blank to keep" : "API Key";
			const modelCount = providerEntry.modelCount;

			return `
				<tr data-provider="${providerAttr}">
					<td class="provider-id-cell">
						<div class="provider-name">${escapeHtml(provider)}</div>
						<div class="provider-meta">${modelCount} ${modelCount === 1 ? "model" : "models"}</div>
					</td>
					<td class="provider-url-cell"><input type="text" class="provider-input" data-field="baseUrl" value="${escapeHtml(baseUrl)}" placeholder="Base URL" /></td>
					<td class="provider-key-cell"><input type="password" class="provider-input" data-field="apiKey" value="" placeholder="${escapeHtml(keyPlaceholder)}" /></td>
					<td class="provider-mode-cell">
						<select class="provider-input" data-field="apiMode">
							<option value="openai" ${apiMode === "openai" ? "selected" : ""}>OpenAI</option>
							<option value="openai-responses" ${apiMode === "openai-responses" ? "selected" : ""}>OpenAI Responses</option>
							<option value="ollama" ${apiMode === "ollama" ? "selected" : ""}>Ollama</option>
							<option value="anthropic" ${apiMode === "anthropic" ? "selected" : ""}>Anthropic</option>
							<option value="gemini" ${apiMode === "gemini" ? "selected" : ""}>Gemini</option>
						</select>
					</td>
					<td class="provider-headers-cell"><textarea class="provider-input provider-headers-input" data-field="headers" rows="2" placeholder='{"X-API-Version": "v1"}'>${escapeHtml(headersJson)}</textarea></td>
					<td class="action-cell">
						<div class="action-buttons">
							<button class="update-provider-btn compact" data-provider="${providerAttr}">Save</button>
							<button class="clear-provider-key-btn secondary compact" data-provider="${providerAttr}" ${hasProviderKey ? "" : "disabled"}>Clear Key</button>
							<button class="delete-provider-btn danger compact" data-provider="${providerAttr}">Delete</button>
						</div>
					</td>
				</tr>`;
		})
		.join("");

	providerTableBody.innerHTML = rows;

	// Add event listeners for provider rows
	document.querySelectorAll(".update-provider-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			const provider = event.target.getAttribute("data-provider");
			const row = event.target.closest("tr");
			const { providerData, headers } = collectProviderRowData(row);

			vscode.postMessage({
				type: "updateProvider",
				provider: provider,
				baseUrl: providerData.baseUrl || undefined,
				apiKey: providerData.apiKey || undefined,
				apiMode: providerData.apiMode || undefined,
				headers: headers,
			});
		});
	});

	document.querySelectorAll(".clear-provider-key-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			const provider = event.target.getAttribute("data-provider");
			const row = event.target.closest("tr");
			const { providerData, headers } = collectProviderRowData(row);

			vscode.postMessage({
				type: "updateProvider",
				provider: provider,
				baseUrl: providerData.baseUrl || undefined,
				clearApiKey: true,
				apiMode: providerData.apiMode || undefined,
				headers: headers,
			});
		});
	});

	document.querySelectorAll(".delete-provider-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			const provider = event.target.getAttribute("data-provider");
			const confirmId = "deleteProvider_" + Date.now();

			// Store the action to be performed after confirmation
			pendingConfirmations.set(confirmId, {
				action: () => vscode.postMessage({ type: "deleteProvider", provider: provider }),
			});

			vscode.postMessage({
				type: "requestConfirm",
				id: confirmId,
				message: `Are you sure you want to delete provider ${provider} and all its models?`,
				action: "deleteProvider",
			});
		});
	});
}

function renderModels() {
	const models = state.models.filter((m) => !isProviderPlaceholderModel(m)).sort((a, b) => a.id.localeCompare(b.id));
	if (!models.length) {
		modelTableBody.innerHTML = '<tr><td colspan="8" class="no-data">No models</td></tr>';
		return;
	}

	const rows = models
		.map((model) => {
			return `
			<tr data-model-id="${model.id}${model.configId ? "::" + model.configId : ""}">
				<td>${model.id}</td>
				<td>${model.owned_by}</td>
				<td>${model.displayName || ""}</td>
				<td>${model.configId || ""}</td>
				<td>${model.context_length || ""}</td>
				<td>${model.max_tokens || model.max_completion_tokens || ""}</td>
				<td>${model.vision ? "True" : ""}</td>
				<td class="action-buttons">
					<button class="update-model-btn" data-model-id="${model.id}${model.configId ? "::" + model.configId : ""}">Edit</button>
					<button class="delete-model-btn danger" data-model-id="${model.id}${model.configId ? "::" + model.configId : ""}">Delete</button>
				</td>
			</tr>`;
		})
		.join("");

	modelTableBody.innerHTML = rows;

	// Add event listeners for model rows
	document.querySelectorAll(".update-model-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			const modelId = event.target.getAttribute("data-model-id");
			// Find the model in state
			const parsedModelId = modelId.includes("::")
				? { baseId: modelId.split("::")[0], configId: modelId.split("::")[1] }
				: { baseId: modelId, configId: null };

			const model = state.models.find(
				(m) =>
					m.id === parsedModelId.baseId &&
					((parsedModelId.configId && m.configId === parsedModelId.configId) ||
						(!parsedModelId.configId && !m.configId))
			);

			if (model) {
				// Show the model form in edit mode
				modelFormSection.style.display = "block";
				modelFormTitle.textContent = `Edit Model: ${modelId}`;
				populateModelForm(model);
			}
		});
	});

	document.querySelectorAll(".delete-model-btn").forEach((btn) => {
		btn.addEventListener("click", (event) => {
			const modelId = event.target.getAttribute("data-model-id");
			requestDeleteModel(modelId);
		});
	});
}

// Reset model form
function resetModelForm() {
	// Clear any error message
	showModelError("");

	modelIdInput.value = "";
	modelProviderInput.value = "";
	modelProviderApiKeyInput.value = "";
	modelDisplayNameInput.value = "";
	modelConfigIdInput.value = "";
	modelBaseUrlInput.value = "";
	modelFamilyInput.value = "";
	modelContextLengthInput.value = 128000;
	modelMaxTokensInput.value = 4096;
	modelVisionInput.value = "";
	modelToolCallingInput.value = "";
	modelApiModeInput.value = "openai";
	modelTemperatureInput.value = 0;
	modelTopPInput.value = "";
	modelDelayInput.value = "";
	modelTopKInput.value = "";
	modelMinPInput.value = "";
	modelFrequencyPenaltyInput.value = "";
	modelPresencePenaltyInput.value = "";
	modelRepetitionPenaltyInput.value = "";
	modelReasoningEffortInput.value = "";
	modelEnableThinkingInput.value = "";
	modelThinkingBudgetInput.value = "";
	modelIncludeReasoningInput.value = "";
	modelMaxCompletionTokensInput.value = "";
	modelReasoningEnabledInput.value = "";
	modelReasoningExcludeInput.value = "";
	modelReasoningEffortORInput.value = "";
	modelReasoningMaxTokensInput.value = "";
	modelThinkingTypeInput.value = "";
	modelSupportsReasoningEffortInput.value = "";
	modelSupportedReasoningEffortsInput.value = "";
	modelDefaultReasoningEffortInput.value = "";
	modelHeadersInput.value = "";
	modelExtraInput.value = "";
	modelPromptCacheInput.value = "";
	advancedSettingsContent.style.display = "none";
	toggleAdvancedSettingsBtn.textContent = "Show Advanced Settings";
	state.selectedModelPresetIds.clear();
	// Remove editing attribute
	modelIdInput.removeAttribute("data-editing");
	modelIdInput.removeAttribute("data-original-id");
	modelIdInput.removeAttribute("data-original-configId");
	// disbale fields when form is reset
	modelBaseUrlInput.disabled = true;
	modelApiModeInput.disabled = true;
	modelHeadersInput.disabled = false;
	// Clear dropdown options
	dropdownContent.innerHTML = "";
	updateModelProviderKeyPlaceholder();
	renderSelectedPresetSummary();
}

function parseCommaSeparatedList(value) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function collectModelProviderApiKey(modelData) {
	const trimmed = modelProviderApiKeyInput.value.trim();
	if (trimmed) {
		return trimmed;
	}
	if (modelData.apiMode === "ollama" && modelData.baseUrl && !state.providerKeys[modelData.owned_by]) {
		return "ollama";
	}
	return undefined;
}

// Collect model form data
function collectModelFormData() {
	const isEditing = modelIdInput.hasAttribute("data-editing");
	const originalModel = isEditing ? getOriginalEditingModel() : {};
	const supportedReasoningEfforts = parseCommaSeparatedList(modelSupportedReasoningEffortsInput.value);

	return {
		...originalModel,
		id: modelIdInput.value.trim(),
		owned_by: modelProviderInput.value.trim(),
		displayName: modelDisplayNameInput.value.trim() || undefined,
		configId: modelConfigIdInput.value.trim() || undefined,
		baseUrl: modelBaseUrlInput.value.trim() || undefined,
		family: modelFamilyInput.value.trim() || undefined,
		context_length: modelContextLengthInput.value ? parseInt(modelContextLengthInput.value) : undefined,
		max_tokens: modelMaxTokensInput.value ? parseInt(modelMaxTokensInput.value) : undefined,
		vision: modelVisionInput.value ? modelVisionInput.value === "true" : undefined,
		toolCalling: modelToolCallingInput.value ? modelToolCallingInput.value === "true" : undefined,
		apiMode: modelApiModeInput.value || undefined,
		temperature: modelTemperatureInput.value !== "" ? parseFloat(modelTemperatureInput.value) : undefined,
		top_p: modelTopPInput.value !== "" ? parseFloat(modelTopPInput.value) : undefined,
		delay: modelDelayInput.value ? parseInt(modelDelayInput.value) : undefined,
		top_k: modelTopKInput.value ? parseInt(modelTopKInput.value) : undefined,
		min_p: modelMinPInput.value !== "" ? parseFloat(modelMinPInput.value) : undefined,
		frequency_penalty:
			modelFrequencyPenaltyInput.value !== "" ? parseFloat(modelFrequencyPenaltyInput.value) : undefined,
		presence_penalty: modelPresencePenaltyInput.value !== "" ? parseFloat(modelPresencePenaltyInput.value) : undefined,
		repetition_penalty:
			modelRepetitionPenaltyInput.value !== "" ? parseFloat(modelRepetitionPenaltyInput.value) : undefined,
		reasoning_effort: modelReasoningEffortInput.value || undefined,
		supports_reasoning_effort: modelSupportsReasoningEffortInput.value
			? modelSupportsReasoningEffortInput.value === "true"
			: undefined,
		supported_reasoning_efforts: supportedReasoningEfforts.length ? supportedReasoningEfforts : undefined,
		default_reasoning_effort: modelDefaultReasoningEffortInput.value || undefined,
		enable_thinking: modelEnableThinkingInput.value ? modelEnableThinkingInput.value === "true" : undefined,
		thinking_budget: modelThinkingBudgetInput.value ? parseInt(modelThinkingBudgetInput.value) : undefined,
		include_reasoning_in_request: modelIncludeReasoningInput.value
			? modelIncludeReasoningInput.value === "true"
			: undefined,
		max_completion_tokens: modelMaxCompletionTokensInput.value
			? parseInt(modelMaxCompletionTokensInput.value)
			: undefined,
		// Build reasoning configuration object
		reasoning: buildReasoningConfig(),
		// Build thinking configuration object
		thinking: buildThinkingConfig(),
		// Parse headers and extra JSON
		headers: parseJsonField(modelHeadersInput.value),
		extra: parseJsonField(modelExtraInput.value),
		prompt_cache: parseJsonField(modelPromptCacheInput.value),
		// Include original modelId and configId for update operations
		originalModelId: isEditing ? modelIdInput.getAttribute("data-original-id") : undefined,
		originalConfigId: isEditing ? modelIdInput.getAttribute("data-original-configId") : undefined,
	};
}

function getOriginalEditingModel() {
	const originalId = modelIdInput.getAttribute("data-original-id") || "";
	const originalConfigId = modelIdInput.getAttribute("data-original-configId") || "";
	return (
		state.models.find(
			(m) =>
				m.id === originalId &&
				((originalConfigId && m.configId === originalConfigId) || (!originalConfigId && !m.configId))
		) || {}
	);
}

// Build reasoning configuration object from form fields
function buildReasoningConfig() {
	const enabled = modelReasoningEnabledInput.value ? modelReasoningEnabledInput.value === "true" : undefined;
	const effort = modelReasoningEffortORInput.value || undefined;
	const exclude = modelReasoningExcludeInput.value ? modelReasoningExcludeInput.value === "true" : undefined;
	const maxTokens = modelReasoningMaxTokensInput.value ? parseInt(modelReasoningMaxTokensInput.value) : undefined;

	// Only return an object if at least one field has a value
	if (enabled !== undefined || effort !== undefined || exclude !== undefined || maxTokens !== undefined) {
		return {
			enabled,
			effort,
			exclude,
			max_tokens: maxTokens,
		};
	}
	return undefined;
}

// Build thinking configuration object from form fields
function buildThinkingConfig() {
	const type = modelThinkingTypeInput.value || undefined;

	if (type !== undefined) {
		return { type };
	}
	return undefined;
}

// Parse JSON field, return undefined if empty or invalid
function parseJsonField(value) {
	if (!value || value.trim() === "") {
		return undefined;
	}
	try {
		return JSON.parse(value.trim());
	} catch (error) {
		// ignore invalid JSON
		return undefined;
	}
}

function validateJsonObjectInput(input, label) {
	const value = input.value.trim();
	if (!value) {
		return true;
	}
	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			showModelError(`${label} must be a valid JSON object.`);
			return false;
		}
		return true;
	} catch (_error) {
		showModelError(`${label} must be a valid JSON object.`);
		return false;
	}
}

// Show error message in the UI
function showModelError(message) {
	if (modelErrorElement) {
		modelErrorElement.textContent = message;
		modelErrorElement.style.display = message ? "block" : "none";

		// Scroll to error message if it's visible
		if (message) {
			modelErrorElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}
}

// Validate model data
function validateModelData(modelData) {
	// Clear any previous error
	showModelError("");

	if (!modelData.id) {
		showModelError("Model ID is required.");
		return false;
	}
	if (!modelData.owned_by) {
		showModelError("Provider ID is required.");
		return false;
	}
	if (
		modelData.baseUrl &&
		modelData.apiMode !== "ollama" &&
		!state.providerKeys[modelData.owned_by] &&
		!modelProviderApiKeyInput.value.trim()
	) {
		showModelError("Provider API Key is required for models with a provider Base URL.");
		return false;
	}

	// Validate modelId and configId Uniqueness
	const isEditing = modelIdInput.hasAttribute("data-editing");
	const hasDuplicate = state.models
		.filter((m) => {
			if (isEditing) {
				const isOrigin =
					m.id === modelData.originalModelId &&
					((modelData.originalConfigId && m.configId === modelData.originalConfigId) ||
						(!modelData.originalConfigId && !m.configId));
				return !isOrigin;
			}
			return true;
		})
		.some((m) => {
			return (
				m.id === modelData.id &&
				((modelData.configId && m.configId === modelData.configId) || (!modelData.configId && !m.configId))
			);
		});

	if (hasDuplicate) {
		showModelError(
			`A model with ID="${modelData.id}"${
				modelData.configId ? ` and Config ID="${modelData.configId}"` : ""
			} already exists. Model ID and Config ID combination must be unique.`
		);
		return false;
	}

	// Validate numeric fields if provided
	if (modelData.context_length !== undefined && (isNaN(modelData.context_length) || modelData.context_length <= 0)) {
		showModelError("Context Length must be a positive number.");
		return false;
	}
	if (modelData.max_tokens !== undefined && (isNaN(modelData.max_tokens) || modelData.max_tokens <= 0)) {
		showModelError("Max Tokens must be a positive number.");
		return false;
	}
	if (
		modelData.max_completion_tokens !== undefined &&
		(isNaN(modelData.max_completion_tokens) || modelData.max_completion_tokens <= 0)
	) {
		showModelError("Max Completion Tokens must be a positive number.");
		return false;
	}
	// Prevent both max_tokens and max_completion_tokens from being set simultaneously
	if (modelData.max_tokens !== undefined && modelData.max_completion_tokens !== undefined) {
		showModelError("Cannot set both 'max_tokens' and 'max_completion_tokens'. Use 'max_completion_tokens' only.");
		return false;
	}
	if (
		modelData.temperature !== undefined &&
		(isNaN(modelData.temperature) || modelData.temperature < 0 || modelData.temperature > 2)
	) {
		showModelError("Temperature must be between 0 and 2.");
		return false;
	}
	if (modelData.top_p !== undefined && (isNaN(modelData.top_p) || modelData.top_p < 0 || modelData.top_p > 1)) {
		showModelError("Top P must be between 0 and 1.");
		return false;
	}
	if (modelData.delay !== undefined && (isNaN(modelData.delay) || modelData.delay < 0)) {
		showModelError("Delay must be a non-negative number.");
		return false;
	}

	// Validate JSON fields
	if (!validateJsonObjectInput(modelHeadersInput, "Custom Headers")) {
		return false;
	}
	if (!validateJsonObjectInput(modelExtraInput, "Extra Parameters")) {
		return false;
	}
	if (!validateJsonObjectInput(modelPromptCacheInput, "Prompt Cache")) {
		return false;
	}

	return true;
}

// Function to populate the model ID datalist
function populateModelIdDropdown(models) {
	const modelsArray = Array.from(models || []);

	// Clear existing options
	dropdownContent.innerHTML = "";

	if (!modelsArray.length) {
		dropdownHeader.textContent = "No models available";
		return;
	}

	dropdownHeader.textContent = `Select Model (${modelsArray.length} available)`;

	// Create option elements
	modelsArray.forEach((model) => {
		const option = document.createElement("div");
		option.className = "dropdown-option";
		option.textContent = model.id;
		option.dataset.modelId = model.id;

		// Add click event
		option.addEventListener("click", () => {
			modelIdInput.value = model.id;
			hideDropdown();

			// Remove selection from all options
			dropdownContent.querySelectorAll(".dropdown-option").forEach((opt) => {
				opt.classList.remove("selected");
			});

			// Add selection to clicked option
			option.classList.add("selected");
		});

		dropdownContent.appendChild(option);
	});
}

// Function to populate the commit model dropdown
function populateCommitModelDropdown() {
	// Clear existing options except the first "None" option
	while (commitModelInput.children.length > 1) {
		commitModelInput.removeChild(commitModelInput.lastChild);
	}

	// Filter models that support commit generation (openai, openai-responses, anthropic, ollama apiMode)
	const commitCompatibleModels = state.models
		.filter((model) => {
			const apiMode = model.apiMode || state.providerInfo[model.owned_by]?.apiMode || "openai";
			return apiMode !== "gemini" && !isProviderPlaceholderModel(model);
		})
		.sort((a, b) => a.id.localeCompare(b.id));

	// Add options for compatible models
	commitCompatibleModels.forEach((model) => {
		const option = document.createElement("option");
		const fullModelId = `${model.id}${model.configId ? "::" + model.configId : ""}`;
		option.value = fullModelId;
		option.textContent = model.displayName || fullModelId;
		commitModelInput.appendChild(option);
	});
}

// Dropdown visibility functions
function showDropdown() {
	if (dropdownContent.children.length > 0) {
		modelIdDropdown.classList.add("show");
	}
}

function hideDropdown() {
	modelIdDropdown.classList.remove("show");
}

function toggleDropdown() {
	if (modelIdDropdown.classList.contains("show")) {
		hideDropdown();
	} else {
		showDropdown();
	}
}

// Populate model form with existing data
function populateModelForm(model) {
	// Clear any error message
	showModelError("");

	// Store the original modelId and configId for update operations
	modelIdInput.setAttribute("data-original-id", model.id || "");
	modelIdInput.setAttribute("data-original-configId", model.configId || "");

	modelIdInput.value = model.id || "";

	// Ensure the provider is in the dropdown options
	const currentProvider = model.owned_by || "";
	const providerExists = Array.from(modelProviderInput.options).some((option) => option.value === currentProvider);

	if (!providerExists && currentProvider) {
		// Add the provider to the dropdown if it doesn't exist
		const newOption = document.createElement("option");
		newOption.value = currentProvider;
		newOption.textContent = currentProvider;
		modelProviderInput.appendChild(newOption);
	}

	const providerInfo = state.providerInfo[currentProvider];
	const fetchBaseUrl = providerInfo?.baseUrl || model.baseUrl || state.baseUrl;
	const fetchApiKey = state.providerKeys[currentProvider] || state.apiKey;
	const fetchApiMode = providerInfo?.apiMode || model.apiMode || modelApiModeInput.value || "openai";

	// Request to fetch remote models for the selected provider
	vscode.postMessage({
		type: "fetchModels",
		baseUrl: fetchBaseUrl,
		apiKey: fetchApiKey,
		apiMode: fetchApiMode,
		headers: providerInfo?.headers ?? model.headers,
	});

	modelProviderInput.value = currentProvider;
	modelProviderApiKeyInput.value = "";
	modelDisplayNameInput.value = model.displayName || "";
	modelConfigIdInput.value = model.configId || "";
	modelBaseUrlInput.value = model.baseUrl || providerInfo?.baseUrl || "";
	modelFamilyInput.value = model.family || "";
	modelContextLengthInput.value = model.context_length || "";
	modelMaxTokensInput.value = model.max_tokens || "";
	modelVisionInput.value = model.vision !== undefined ? String(model.vision) : "";
	modelToolCallingInput.value = model.toolCalling !== undefined ? String(model.toolCalling) : "";
	modelApiModeInput.value = model.apiMode || providerInfo?.apiMode || "openai";
	modelTemperatureInput.value = model.temperature !== undefined && model.temperature !== null ? model.temperature : "";
	modelTopPInput.value = model.top_p !== undefined && model.top_p !== null ? model.top_p : "";
	modelDelayInput.value = model.delay || "";
	modelTopKInput.value = model.top_k || "";
	modelMinPInput.value = model.min_p || "";
	modelFrequencyPenaltyInput.value = model.frequency_penalty || "";
	modelPresencePenaltyInput.value = model.presence_penalty || "";
	modelRepetitionPenaltyInput.value = model.repetition_penalty || "";
	modelReasoningEffortInput.value = model.reasoning_effort || "";
	modelSupportsReasoningEffortInput.value =
		model.supports_reasoning_effort !== undefined ? String(model.supports_reasoning_effort) : "";
	modelSupportedReasoningEffortsInput.value = Array.isArray(model.supported_reasoning_efforts)
		? model.supported_reasoning_efforts.join(",")
		: "";
	modelDefaultReasoningEffortInput.value = model.default_reasoning_effort || "";
	modelEnableThinkingInput.value = model.enable_thinking !== undefined ? String(model.enable_thinking) : "";
	modelThinkingBudgetInput.value = model.thinking_budget || "";
	modelIncludeReasoningInput.value =
		model.include_reasoning_in_request !== undefined ? String(model.include_reasoning_in_request) : "";
	modelMaxCompletionTokensInput.value = model.max_completion_tokens || "";
	// Populate reasoning configuration
	if (model.reasoning) {
		modelReasoningEnabledInput.value = model.reasoning.enabled !== undefined ? String(model.reasoning.enabled) : "";
		modelReasoningEffortORInput.value = model.reasoning.effort || "";
		modelReasoningExcludeInput.value = model.reasoning.exclude !== undefined ? String(model.reasoning.exclude) : "";
		modelReasoningMaxTokensInput.value = model.reasoning.max_tokens || "";
	}
	// Populate thinking configuration
	if (model.thinking) {
		modelThinkingTypeInput.value = model.thinking.type || "";
	}
	// Populate headers and extra
	const headers = model.headers ?? providerInfo?.headers;
	modelHeadersInput.value = headers ? JSON.stringify(headers, null, 2) : "";
	modelExtraInput.value = model.extra ? JSON.stringify(model.extra, null, 2) : "";
	modelPromptCacheInput.value = model.prompt_cache ? JSON.stringify(model.prompt_cache, null, 2) : "";
	// Mark that we're in editing mode by setting an attribute
	modelIdInput.setAttribute("data-editing", "true");
	// Disable BaseURL and apiMode fields when editing
	modelBaseUrlInput.disabled = true;
	modelApiModeInput.disabled = true;
	setModelFormMode("edit");
	updateModelProviderKeyPlaceholder();
}

// Initialize dropdown event listeners
function initDropdownEvents() {
	// Show dropdown on focus
	modelIdInput.addEventListener("focus", () => {
		if (dropdownContent.children.length > 0) {
			showDropdown();
		}
	});

	// Hide dropdown when clicking outside
	document.addEventListener("click", (event) => {
		if (!modelIdDropdown.contains(event.target) && event.target !== modelIdInput) {
			hideDropdown();
		}
	});

	// Handle keyboard navigation
	modelIdInput.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			hideDropdown();
		} else if (event.key === "ArrowDown" && modelIdDropdown.classList.contains("show")) {
			event.preventDefault();
			const options = dropdownContent.querySelectorAll(".dropdown-option");
			if (options.length > 0) {
				const firstOption = options[0];
				firstOption.focus();
				firstOption.classList.add("selected");
			}
		}
	});

	// Allow user to type freely
	modelIdInput.addEventListener("input", () => {
		// Clear selection when user types
		dropdownContent.querySelectorAll(".dropdown-option").forEach((opt) => {
			opt.classList.remove("selected");
		});

		// Filter options based on input
		const searchTerm = modelIdInput.value.toLowerCase();
		const options = dropdownContent.querySelectorAll(".dropdown-option");

		options.forEach((option) => {
			const modelId = option.dataset.modelId.toLowerCase();
			if (modelId.includes(searchTerm)) {
				option.style.display = "block";
			} else {
				option.style.display = "none";
			}
		});

		// Update header with filtered count
		const visibleCount = Array.from(options).filter((opt) => opt.style.display !== "none").length;
		dropdownHeader.textContent = `Select Model (${visibleCount} matching)`;
	});
}

// Initialize dropdown events
initDropdownEvents();

vscode.postMessage({ type: "requestInit" });

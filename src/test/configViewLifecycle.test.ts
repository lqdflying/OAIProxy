import * as assert from "assert";
import * as vscode from "vscode";
import { ConfigViewPanel } from "../views/configView";
import { isCommitGenerationCompatibleModel, PROVIDER_CONFIG_STORAGE_KEY } from "../providerTransport";
import type { HFModelItem, ProviderConfigItem } from "../types";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

suite("configuration panel lifecycle", () => {
	const originalCreate = vscode.window.createWebviewPanel;
	const originalConfig = vscode.workspace.getConfiguration;
	const originalRead = vscode.workspace.fs?.readFile;
	const originalWrite = vscode.workspace.fs?.writeFile;
	const originalSaveDialog = vscode.window.showSaveDialog;
	const originalOpenDialog = vscode.window.showOpenDialog;
	const originalWarning = vscode.window.showWarningMessage;
	const originalInformation = vscode.window.showInformationMessage;
	const originalError = vscode.window.showErrorMessage;
	let configuration: Record<string, unknown>;
	let globalStateValues: Record<string, unknown>;
	let reads: string[];
	let stored: Map<string, string>;
	let migrations: string[];
	let writtenFiles: Map<string, string>;
	let inputFiles: Map<string, string>;
	let saveDialogUri: vscode.Uri | undefined;
	let openDialogUris: vscode.Uri[] | undefined;
	let warningResponse: string | undefined;
	let warningMessages: string[];
	let informationMessages: string[];
	let errorMessages: string[];
	let failSecretStoreKey: string | undefined;
	let failedSecretStore: boolean;
	let active: number;
	let peak: number;
	let readGate: Promise<void> | undefined;
	let htmlGate: Promise<Uint8Array> | undefined;
	let failReads: boolean;
	let panels: ReturnType<typeof makePanel>[];

	function makePanel() {
		let disposed = false;
		let disposeHandler: (() => void) | undefined;
		let receive: ((message: unknown) => void) | undefined;
		const messages: Array<{ type: string; payload?: Record<string, unknown> }> = [];
		const webview = {
			html: "",
			cspSource: "test",
			asWebviewUri: (uri: vscode.Uri) => uri,
			postMessage: async (message: (typeof messages)[number]) => {
				assert.ok(!disposed);
				messages.push(message);
				return true;
			},
			onDidReceiveMessage: (handler: typeof receive) => {
				receive = handler;
				return { dispose() {} };
			},
		};
		const panel = {
			get webview() {
				if (disposed) {
					throw new Error("Webview is disposed");
				}
				return webview;
			},
			onDidDispose: (handler: () => void) => {
				disposeHandler = handler;
				return { dispose() {} };
			},
			dispose: () => {
				if (!disposed) {
					disposed = true;
					disposeHandler?.();
				}
			},
			reveal() {},
		};
		return { panel, webview, messages, receive: (message: unknown) => receive?.(message) };
	}

	function open() {
		ConfigViewPanel.openPanel(
			vscode.Uri.file("/test"),
			{
				get: async (key: string) => {
					reads.push(key);
					peak = Math.max(peak, ++active);
					try {
						if (readGate) {
							await readGate;
						}
						await new Promise((resolve) => setTimeout(resolve, 2));
						if (failReads) {
							throw new Error("secret read failed");
						}
						return stored.get(key);
					} finally {
						active--;
					}
				},
				store: async (key: string, value: string) => {
					if (!failedSecretStore && key === failSecretStoreKey) {
						failedSecretStore = true;
						throw new Error("secret store failed");
					}
					stored.set(key, value);
					migrations.push(`store:${key}`);
				},
				delete: async (key: string) => {
					stored.delete(key);
					migrations.push(`delete:${key}`);
				},
			} as unknown as vscode.SecretStorage,
			{
				get: (key: string, fallback: unknown) =>
					Object.prototype.hasOwnProperty.call(globalStateValues, key) ? globalStateValues[key] : fallback,
				update: async (key: string, value: unknown) => {
					globalStateValues[key] = value;
				},
			} as unknown as vscode.Memento,
			async () => ({ durationMs: 1 })
		);
		return ConfigViewPanel.currentPanel!;
	}

	setup(() => {
		configuration = {};
		globalStateValues = {};
		reads = [];
		stored = new Map();
		migrations = [];
		writtenFiles = new Map();
		inputFiles = new Map();
		saveDialogUri = undefined;
		openDialogUris = undefined;
		warningResponse = undefined;
		warningMessages = [];
		informationMessages = [];
		errorMessages = [];
		failSecretStoreKey = undefined;
		failedSecretStore = false;
		active = 0;
		peak = 0;
		readGate = undefined;
		htmlGate = undefined;
		failReads = false;
		panels = [];
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => configuration[key] ?? fallback,
			update: async (key: string, value: unknown) => {
				configuration[key] = value;
			},
			inspect: (key: string) => ({ key, globalValue: configuration[key] }),
		})) as unknown as typeof originalConfig;
		vscode.workspace.fs.readFile = async (uri: vscode.Uri) => {
			const input = inputFiles.get(uri.fsPath);
			return input !== undefined
				? new TextEncoder().encode(input)
				: htmlGate ?? new TextEncoder().encode("test html");
		};
		vscode.workspace.fs.writeFile = async (uri: vscode.Uri, content: Uint8Array) => {
			writtenFiles.set(uri.fsPath, new TextDecoder().decode(content));
		};
		vscode.window.showSaveDialog = (async () => saveDialogUri) as typeof originalSaveDialog;
		vscode.window.showOpenDialog = (async () => openDialogUris) as typeof originalOpenDialog;
		vscode.window.showWarningMessage = (async (message: string) => {
			warningMessages.push(message);
			return warningResponse;
		}) as typeof originalWarning;
		vscode.window.showInformationMessage = (async (message: string) => {
			informationMessages.push(message);
			return undefined;
		}) as typeof originalInformation;
		vscode.window.showErrorMessage = (async (message: string) => {
			errorMessages.push(message);
			return undefined;
		}) as typeof originalError;
		vscode.window.createWebviewPanel = (() => {
			const fake = makePanel();
			panels.push(fake);
			return fake.panel;
		}) as unknown as typeof originalCreate;
	});
	teardown(() => {
		ConfigViewPanel.currentPanel?.dispose();
		vscode.window.createWebviewPanel = originalCreate;
		vscode.workspace.getConfiguration = originalConfig;
		vscode.workspace.fs.readFile = originalRead;
		vscode.workspace.fs.writeFile = originalWrite;
		vscode.window.showSaveDialog = originalSaveDialog;
		vscode.window.showOpenDialog = originalOpenDialog;
		vscode.window.showWarningMessage = originalWarning;
		vscode.window.showInformationMessage = originalInformation;
		vscode.window.showErrorMessage = originalError;
	});

	test("waits for readiness, coalesces duplicate init and bounds parallel credential reads", async () => {
		const view = open();
		await tick();
		assert.strictEqual(reads.length, 0);
		const gate = deferred<void>();
		readGate = gate.promise;
		const first = view.handleMessage({ type: "requestInit" });
		const second = view.handleMessage({ type: "requestInit" });
		assert.strictEqual(active, 8);
		gate.resolve();
		await Promise.all([first, second]);
		assert.strictEqual(peak, 8);
		assert.strictEqual(panels[0].messages.length, 1);
		assert.strictEqual(reads.filter((key) => key === "oaicopilot.apiKey").length, 1);
		assert.ok(reads.length >= 35, "fixture must exercise all preset credential reads");
	});

	test("closing during HTML load cannot overwrite a newly opened panel", async () => {
		const gate = deferred<Uint8Array>();
		htmlGate = gate.promise;
		const old = open();
		old.dispose();
		htmlGate = undefined;
		const current = open();
		gate.resolve(new TextEncoder().encode("old html"));
		await tick();
		old.dispose();
		assert.strictEqual(ConfigViewPanel.currentPanel, current);
		assert.strictEqual(panels[0].webview.html, "");
		assert.strictEqual(panels[1].webview.html, "test html");
	});

	test("closing during credential reads stops scheduling and never posts to the disposed panel", async () => {
		const gate = deferred<void>();
		readGate = gate.promise;
		const view = open();
		const pending = view.handleMessage({ type: "requestInit" });
		view.dispose();
		gate.resolve();
		await pending;
		assert.strictEqual(panels[0].messages.length, 0);
		assert.strictEqual(reads.length, 8);
	});

	test("configuration mutation during init discards the stale snapshot", async () => {
		configuration["oaicopilot.baseUrl"] = "https://old.example";
		const gate = deferred<void>();
		readGate = gate.promise;
		const view = open();
		const pending = view.handleMessage({ type: "requestInit" });
		configuration["oaicopilot.baseUrl"] = "https://new.example";
		const refreshed = (view as unknown as { sendInit(): Promise<void> }).sendInit();
		gate.resolve();
		await Promise.all([pending, refreshed]);
		assert.strictEqual(panels[0].messages.length, 1);
		assert.strictEqual(panels[0].messages[0].payload?.baseUrl, "https://new.example");
	});

	test("legacy mixed-case credentials migrate in order and reach every provider alias", async () => {
		configuration["oaicopilot.models"] = [{ id: "model", owned_by: "OpenAI", baseUrl: "https://example.com" }];
		stored.set("oaicopilot.apiKey.OpenAI", "private-test-key");
		const view = open();
		await view.handleMessage({ type: "requestInit" });
		assert.deepStrictEqual(migrations, ["store:oaicopilot.apiKey.openai", "delete:oaicopilot.apiKey.OpenAI"]);
		const keys = panels[0].messages[0].payload?.providerKeys as Record<string, string>;
		assert.strictEqual(keys.OpenAI, "private-test-key");
		assert.strictEqual(keys.openai, "private-test-key");
	});

	test("read failure reports recoverable init error through the real message handler", async () => {
		failReads = true;
		const view = open();
		panels[0].receive({ type: "requestInit" });
		for (let i = 0; i < 100 && !panels[0].messages.length; i++) {
			await new Promise((resolve) => setTimeout(resolve, 2));
		}
		assert.deepStrictEqual(panels[0].messages, [{ type: "initError" }]);
		failReads = false;
		await view.handleMessage({ type: "requestInit" });
		assert.strictEqual(panels[0].messages.at(-1)?.type, "init");
	});

	test("stores OpenAI API-key providers without requiring an explicit auth mode", async () => {
		const view = open();

		await view.handleMessage({
			type: "addProvider",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-first",
			apiMode: "openai",
		});
		assert.strictEqual(stored.get("oaicopilot.apiKey.openai"), "sk-first");
		let providerConfigs = globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] as ProviderConfigItem[];
		assert.strictEqual(providerConfigs[0].authMode, "api-key");

		await view.handleMessage({
			type: "updateProvider",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			apiKey: "sk-second",
			apiMode: "openai",
		});
		assert.strictEqual(stored.get("oaicopilot.apiKey.openai"), "sk-second");
		providerConfigs = globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] as ProviderConfigItem[];
		assert.strictEqual(providerConfigs[0].authMode, "api-key");
	});

	test("recovers a stale OpenAI OAuth provider row without deleting an entered API key", async () => {
		globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] = [
			{ provider: "openai", baseUrl: "https://api.openai.com/v1", apiMode: "openai", authMode: "oauth" },
		];
		const view = open();

		await view.handleMessage({
			type: "updateProvider",
			provider: "openai",
			apiKey: "sk-recovered",
			apiMode: "openai",
			authMode: "oauth",
		});

		assert.strictEqual(stored.get("oaicopilot.apiKey.openai"), "sk-recovered");
		const providerConfigs = globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] as ProviderConfigItem[];
		assert.strictEqual(providerConfigs[0].authMode, "api-key");
		assert.strictEqual(providerConfigs[0].baseUrl, "https://api.openai.com/v1");
	});

	test("keeps the dedicated OpenAI OAuth provider in OAuth mode", async () => {
		globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] = [
			{
				provider: "openai-oauth",
				baseUrl: "https://chatgpt.com/backend-api/codex",
				apiMode: "openai-responses",
				authMode: "oauth",
			},
		];
		const view = open();

		await view.handleMessage({
			type: "updateProvider",
			provider: "openai-oauth",
			apiKey: "sk-not-used",
			apiMode: "openai-responses",
			authMode: "oauth",
		});

		assert.strictEqual(stored.has("oaicopilot.apiKey.openai-oauth"), false);
		const providerConfigs = globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] as ProviderConfigItem[];
		assert.strictEqual(providerConfigs[0].authMode, "oauth");
	});

	test("clears the previous commit model when None is selected", async () => {
		configuration["oaicopilot.models"] = [
			{ id: "gpt-test", owned_by: "openai", useForCommitGeneration: true },
		];
		const view = open();

		await view.handleMessage({
			type: "saveGlobalConfig",
			baseUrl: "",
			apiKey: "",
			delay: 0,
			readFileLines: 0,
			retry: {},
			commitModel: "",
			commitLanguage: "English",
		});

		const models = configuration["oaicopilot.models"] as HFModelItem[];
		assert.strictEqual(models[0].useForCommitGeneration, undefined);
	});

	test("excludes OAuth, Gemini, and provider-placeholder models from commit generation", () => {
		const providers: ProviderConfigItem[] = [
			{ provider: "openai-oauth", authMode: "oauth" },
			{ provider: "gemini", apiMode: "gemini" },
		];

		assert.strictEqual(
			isCommitGenerationCompatibleModel({ id: "codex", owned_by: "openai-oauth" }, providers),
			false
		);
		assert.strictEqual(
			isCommitGenerationCompatibleModel({ id: "gemini-test", owned_by: "gemini" }, providers),
			false
		);
		assert.strictEqual(
			isCommitGenerationCompatibleModel({ id: "oauth-model", owned_by: "xai", authMode: "oauth" }),
			false
		);
		assert.strictEqual(
			isCommitGenerationCompatibleModel({ id: "__provider__openai", owned_by: "openai" }),
			false
		);
		assert.strictEqual(isCommitGenerationCompatibleModel({ id: "gpt-test", owned_by: "openai" }), true);
	});

	test("exports without keys by default and requires warning confirmation to include them", async () => {
		configuration["oaicopilot.models"] = [
			{
				id: "gpt-test",
				owned_by: "openai",
				baseUrl: "https://api.openai.com/v1",
				headers: { "Custom-Auth-Token": "model-header-secret", "X-Trace": "model-trace" },
			},
		];
		globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] = [
			{
				provider: "openai",
				baseUrl: "https://api.openai.com/v1",
				apiMode: "openai",
				authMode: "api-key",
				headers: { "X-Api-Key": "provider-header-secret", "X-Request-Mode": "provider-mode" },
			},
		];
		stored.set("oaicopilot.apiKey", "generic-secret");
		stored.set("oaicopilot.apiKey.openai", "provider-secret");
		stored.set("oaicopilot.usageApiKey.openai", "usage-secret");
		const view = open();

		saveDialogUri = vscode.Uri.file("/tmp/export-default.json");
		await view.handleMessage({ type: "exportConfig" });
		const defaultExport = JSON.parse(writtenFiles.get("/tmp/export-default.json") ?? "{}");
		assert.strictEqual("apiKey" in defaultExport, false);
		assert.strictEqual("providerKeys" in defaultExport, false);
		assert.strictEqual("providerUsageKeys" in defaultExport, false);
		assert.strictEqual(defaultExport.models[0].headers["Custom-Auth-Token"], "[REDACTED]");
		assert.strictEqual(defaultExport.models[0].headers["X-Trace"], "model-trace");
		assert.strictEqual(defaultExport.providers[0].headers["X-Api-Key"], "[REDACTED]");
		assert.strictEqual(defaultExport.providers[0].headers["X-Request-Mode"], "provider-mode");
		assert.deepStrictEqual(warningMessages, []);

		saveDialogUri = vscode.Uri.file("/tmp/export-cancelled.json");
		warningResponse = "Cancel";
		await view.handleMessage({ type: "exportConfig", includeApiKeys: true });
		assert.strictEqual(writtenFiles.has("/tmp/export-cancelled.json"), false);

		saveDialogUri = vscode.Uri.file("/tmp/export-with-keys.json");
		warningResponse = "Export with API keys";
		await view.handleMessage({ type: "exportConfig", includeApiKeys: true });
		const keyExport = JSON.parse(writtenFiles.get("/tmp/export-with-keys.json") ?? "{}");
		assert.match(warningMessages.at(-1) ?? "", /cleartext/u);
		assert.strictEqual(keyExport.apiKey, "generic-secret");
		assert.strictEqual(keyExport.providerKeys.openai, "provider-secret");
		assert.strictEqual(keyExport.providerUsageKeys.openai, "usage-secret");
		assert.strictEqual(keyExport.models[0].headers["Custom-Auth-Token"], "model-header-secret");
		assert.strictEqual(keyExport.providers[0].headers["X-Api-Key"], "provider-header-secret");
	});

	test("rejects a malformed import before mutating configuration or secrets", async () => {
		configuration["oaicopilot.baseUrl"] = "https://existing.example/v1";
		configuration["oaicopilot.models"] = [{ id: "existing", owned_by: "openai" }];
		globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] = [
			{ provider: "existing", baseUrl: "https://existing.example/v1", apiMode: "openai", authMode: "api-key" },
		];
		stored.set("oaicopilot.apiKey.openai", "existing-secret");
		inputFiles.set(
			"/tmp/import-invalid.json",
			JSON.stringify({ baseUrl: "https://attacker.example/v1", models: [], providerKeys: [] })
		);
		openDialogUris = [vscode.Uri.file("/tmp/import-invalid.json")];
		const view = open();

		await view.handleMessage({ type: "importConfig" });

		assert.strictEqual(configuration["oaicopilot.baseUrl"], "https://existing.example/v1");
		assert.deepStrictEqual(configuration["oaicopilot.models"], [{ id: "existing", owned_by: "openai" }]);
		assert.deepStrictEqual(globalStateValues[PROVIDER_CONFIG_STORAGE_KEY], [
			{ provider: "existing", baseUrl: "https://existing.example/v1", apiMode: "openai", authMode: "api-key" },
		]);
		assert.strictEqual(stored.get("oaicopilot.apiKey.openai"), "existing-secret");
		assert.match(errorMessages.at(-1) ?? "", /Failed to import configuration/u);
	});

	test("rolls back configuration, providers, and secrets when import application fails", async () => {
		const previousModels: HFModelItem[] = [{ id: "existing", owned_by: "openai" }];
		const previousProviders: ProviderConfigItem[] = [
			{ provider: "openai", baseUrl: "https://existing.example/v1", apiMode: "openai", authMode: "api-key" },
		];
		configuration["oaicopilot.baseUrl"] = "https://existing.example/v1";
		configuration["oaicopilot.models"] = previousModels;
		globalStateValues[PROVIDER_CONFIG_STORAGE_KEY] = previousProviders;
		stored.set("oaicopilot.apiKey.openai", "existing-secret");
		inputFiles.set(
			"/tmp/import-rollback.json",
			JSON.stringify({
				baseUrl: "https://imported.example/v1",
				models: [{ id: "imported", owned_by: "openai" }],
				providers: [
					{ provider: "openai", baseUrl: "https://imported.example/v1", apiMode: "openai", authMode: "api-key" },
				],
				providerKeys: { openai: "imported-secret" },
			})
		);
		openDialogUris = [vscode.Uri.file("/tmp/import-rollback.json")];
		failSecretStoreKey = "oaicopilot.apiKey.openai";
		const view = open();

		await view.handleMessage({ type: "importConfig" });

		assert.strictEqual(configuration["oaicopilot.baseUrl"], "https://existing.example/v1");
		assert.deepStrictEqual(configuration["oaicopilot.models"], previousModels);
		assert.deepStrictEqual(globalStateValues[PROVIDER_CONFIG_STORAGE_KEY], previousProviders);
		assert.strictEqual(stored.get("oaicopilot.apiKey.openai"), "existing-secret");
		assert.match(errorMessages.at(-1) ?? "", /secret store failed/u);
	});
});

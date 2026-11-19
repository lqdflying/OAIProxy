import * as assert from "assert";
import * as path from "path";
import { png } from "./fixtures/image";
import * as vscode from "vscode";
import { OpenaiApi } from "../openai/openaiApi";
import { OpenaiResponsesApi } from "../openai/openaiResponsesApi";
import { prepareMessagesForApi } from "../messageContent";
import { readImageSize } from "../tokenizer/imageUtils";
import { TokenizerManager, tokenizerManager } from "../tokenizer/tokenizerManager";
import {
	countMessageTokenDetails,
	countToolTokens,
	estimateImageTokens,
	estimatePreparedRequest,
	textTokenLength,
} from "../tokenEstimator";
import {
	DEFAULT_TOKEN_ESTIMATION,
	resolveTokenEstimationConfig,
	type EstimationContext,
} from "../tokenEstimationConfig";
import { createTokenUsageReport, getTokenBudgetErrorMessage } from "../tokenUsage";
import { TokenCalibration, calibrationKey } from "../tokenCalibration";
import { getCachedVisionDescription, messagesContainImages, processMessagesForVision } from "../visionBridge";

function message(role: number, content: unknown[]): vscode.LanguageModelChatRequestMessage {
	return { role, name: undefined, content } as vscode.LanguageModelChatRequestMessage;
}
function imageResult(id: string, bytes: Uint8Array): vscode.LanguageModelChatRequestMessage {
	return message(1, [
		new vscode.LanguageModelToolResultPart(id, [new vscode.LanguageModelDataPart(bytes, "image/png")]),
	]);
}
const context: EstimationContext = {
	includeReasoningInRequest: false,
	modelId: "gpt-6-astra",
	settings: DEFAULT_TOKEN_ESTIMATION,
	imageMode: "native",
	apiMode: "openai",
	imageSources: new Map(),
};

suite("binary tool results and token estimator", () => {
	setup(() => {
		TokenizerManager.setExtensionPath(path.resolve(__dirname, "../.."));
	});

	test("image dimensions and estimates are independent of compressed size and support slices", async () => {
		const small = png(744, 1053, 50000);
		const large = png(744, 1053, 500000);
		for (const bytes of [small, large]) {
			const padded = new Uint8Array(bytes.length + 9);
			padded.set(bytes, 7);
			assert.deepStrictEqual(readImageSize(padded.subarray(7, 7 + bytes.length), "image/png"), {
				width: 744,
				height: 1053,
			});
			const details = await countMessageTokenDetails(imageResult("image", bytes), context);
			assert.strictEqual(details.imageTokens, 951);
			assert.ok(details.totalTokens < 1200);
		}
		assert.strictEqual(
			estimateImageTokens({ width: 744, height: 1053 }, DEFAULT_TOKEN_ESTIMATION.image, "claude-opus-4-7").tokens,
			1026
		);
		assert.strictEqual(estimateImageTokens(undefined, DEFAULT_TOKEN_ESTIMATION.image, "gpt-6-astra").tokens, 8192);
		assert.strictEqual(
			estimateImageTokens({ width: 744, height: 1053 }, DEFAULT_TOKEN_ESTIMATION.image, "gateway-alias").confidence,
			"heuristic"
		);
	});

	test("published image examples and detail levels use model-specific rules", () => {
		const cfg = DEFAULT_TOKEN_ESTIMATION.image;
		assert.strictEqual(estimateImageTokens({ width: 1024, height: 1024 }, cfg, "gpt-6-astra", "high").tokens, 1229);
		assert.strictEqual(estimateImageTokens({ width: 2048, height: 2048 }, cfg, "gpt-6-astra", "high").tokens, 3000);
		assert.strictEqual(estimateImageTokens({ width: 2048, height: 2048 }, cfg, "gpt-6-astra", "auto").tokens, 4916);
		assert.strictEqual(estimateImageTokens({ width: 4096, height: 512 }, cfg, "gpt-6-astra", "high").tokens, 2458);
		assert.strictEqual(estimateImageTokens({ width: 4096, height: 512 }, cfg, "gpt-4o", "low").tokens, 85);
		assert.strictEqual(estimateImageTokens({ width: 1000, height: 1000 }, cfg, "claude-opus-4-7").tokens, 1296);
		assert.strictEqual(estimateImageTokens({ width: 3840, height: 2160 }, cfg, "claude-opus-4-7").tokens, 4784);
	});

	test("bounds-checks JPEG/GIF/WebP variants and malformed headers", () => {
		const jpeg = new Uint8Array([255, 216, 255, 255, 193, 0, 8, 8, 4, 29, 2, 232, 1, 255, 217]);
		assert.deepStrictEqual(readImageSize(jpeg, "image/jpeg"), { width: 744, height: 1053 });
		const gif = Buffer.from([71, 73, 70, 56, 57, 97, 232, 2, 29, 4]);
		assert.deepStrictEqual(readImageSize(gif, "image/gif"), { width: 744, height: 1053 });
		for (const kind of ["VP8X", "VP8L", "VP8 "]) {
			const buffer = Buffer.alloc(30);
			buffer.write("RIFF");
			buffer.writeUInt32LE(22, 4);
			buffer.write("WEBP", 8);
			buffer.write(kind, 12);
			buffer.writeUInt32LE(10, 16);
			if (kind === "VP8X") {
				buffer.writeUIntLE(743, 24, 3);
				buffer.writeUIntLE(1052, 27, 3);
			}
			if (kind === "VP8L") {
				buffer[20] = 0x2f;
				buffer.writeUInt32LE(743 | (1052 << 14), 21);
			}
			if (kind === "VP8 ") {
				buffer.set([157, 1, 42], 23);
				buffer.writeUInt16LE(744, 26);
				buffer.writeUInt16LE(1053, 28);
			}
			assert.deepStrictEqual(readImageSize(buffer, "image/webp"), { width: 744, height: 1053 });
			for (let length = 0; length < 20; length++) {
				assert.strictEqual(readImageSize(buffer.subarray(0, length), "image/webp"), undefined);
			}
		}
		assert.strictEqual(readImageSize(new Uint8Array([255, 216, 255, 193, 255, 255]), "image/jpeg"), undefined);
	});

	test("prepared accounting excludes base64 and counts tool names/results and exact decoded text", async () => {
		const plain = "hello world ".repeat(1000);
		const input = [
			message(2, [new vscode.LanguageModelToolCallPart("a", "long_tool_name", { path: "test" })]),
			message(1, [new vscode.LanguageModelToolResultPart("a", [new vscode.LanguageModelTextPart(plain)])]),
		];
		const converted = new OpenaiApi("gpt-6-astra").convertMessages(input, context);
		const wire = await estimatePreparedRequest({ messages: converted }, context);
		assert.strictEqual(wire.details.toolResultTokens, await textTokenLength(plain));
		assert.ok(wire.details.toolCallTokens > 0);
		const local = await countMessageTokenDetails(input[1], context);
		assert.strictEqual(local.toolResultTokens, wire.details.toolResultTokens);
		const preparedImages = new OpenaiResponsesApi("gpt-6-astra").convertMessages([imageResult("a", png())], context);
		assert.strictEqual((await estimatePreparedRequest({ input: preparedImages }, context)).details.imageTokens, 951);
		const report = await createTokenUsageReport({
			messages: input,
			tools: [],
			model: {
				id: "gpt-6-astra",
				name: "Astra",
				maxInputTokens: 100,
				maxOutputTokens: 10,
			} as vscode.LanguageModelChatInformation,
			modelConfig: context,
			preparedBody: { messages: converted },
		});
		assert.strictEqual(report.inputTokens, wire.details.totalTokens);
		assert.strictEqual(
			report.categories.reduce((sum, c) => sum + c.tokens, 0),
			report.inputTokens
		);
		assert.ok(getTokenBudgetErrorMessage(report)!.includes("Largest parts:"));
	});

	test("prepared accounting treats developer messages as system context", async () => {
		const conversation = [{ role: "user", content: "Explain the failing test." }];
		const asSystem = await estimatePreparedRequest(
			{ messages: [{ role: "system", content: "You are a coding agent." }, ...conversation] },
			context
		);
		const asDeveloper = await estimatePreparedRequest(
			{ messages: [{ role: "developer", content: "You are a coding agent." }, ...conversation] },
			context
		);
		assert.ok(asSystem.textCategories.systemContext > 0);
		assert.deepStrictEqual(asDeveloper.textCategories, asSystem.textCategories);
	});

	test("three valid page screenshots no longer trigger the incident budget", async () => {
		const input = [0, 1, 2].map((i) => imageResult(String(i), png(744, 1053, 150000)));
		const body = { input: new OpenaiResponsesApi("gpt-6-astra").convertMessages(input, context) };
		const report = await createTokenUsageReport({
			messages: input,
			tools: [],
			model: {
				id: "gpt-6-astra",
				name: "Astra",
				maxInputTokens: 872000,
				maxOutputTokens: 128000,
			} as vscode.LanguageModelChatInformation,
			modelConfig: context,
			preparedBody: body,
		});
		assert.ok(report.inputTokens < 4000);
		assert.strictEqual(getTokenBudgetErrorMessage(report), undefined);
		assert.strictEqual(report.categories.find((c) => c.id === "media")!.tokens, 2853);
	});

	test("tool definitions and metadata use the same semantic accounting", async () => {
		const tools = [
			{
				name: "read_file",
				description: "Read a file",
				inputSchema: { type: "object", properties: { path: { type: "string" } } },
			},
		];
		const api = new OpenaiApi("gpt-6-astra");
		const input = [
			message(1, [new vscode.LanguageModelTextPart("read")]),
			message(2, [new vscode.LanguageModelDataPart(new TextEncoder().encode("private metadata"), "usage")]),
		];
		const body = api.prepareRequestBody({ messages: api.convertMessages(input, context) }, undefined, {
			tools,
			toolMode: vscode.LanguageModelChatToolMode.Auto,
			requestInitiator: "test",
		});
		const estimate = await estimatePreparedRequest(body, context);
		assert.strictEqual(estimate.toolDefinitionTokens, await countToolTokens(tools, context));
		assert.strictEqual((await countMessageTokenDetails(input[1], context)).totalTokens, 0);
		const first = await countMessageTokenDetails(input[0], context);
		assert.strictEqual(first.totalTokens, estimate.details.totalTokens);
		(input[0].content[0] as vscode.LanguageModelTextPart).value = "read much more ".repeat(100);
		assert.ok((await countMessageTokenDetails(input[0], context)).totalTokens > first.totalTokens);
	});

	test("tokenizer rejection uses Unicode fallback and does not log content", async () => {
		const original = tokenizerManager.countTokens;
		tokenizerManager.countTokens = async () => {
			throw new Error("private text must not be logged");
		};
		try {
			assert.strictEqual(await textTokenLength("hello"), 2);
			assert.strictEqual(await textTokenLength("界".repeat(1000)), 1000);
			assert.strictEqual(await textTokenLength("😀".repeat(10)), 10);
		} finally {
			tokenizerManager.countTokens = original;
		}
	});

	test("configuration uses exact ID precedence and rejects invalid values", () => {
		const config = resolveTokenEstimationConfig(
			{
				image: { fallbackTokens: 9000 },
				perModel: {
					model: { image: { fixedTokens: 100 } },
					"model::a": { image: { strategy: "fixed", fixedTokens: 200 }, charsPerToken: -1 },
				},
			},
			"model::a"
		);
		assert.strictEqual(config.image.fixedTokens, 200);
		assert.strictEqual(config.image.fallbackTokens, 9000);
		assert.strictEqual(config.charsPerToken, 4);
		assert.strictEqual(config.calibration, "observe");
	});

	test("calibration is isolated, bounded, opt-in and excludes ineligible samples", async () => {
		const stored = new Map<string, unknown>();
		const state = {
			keys: () => [...stored.keys()],
			get: (key: string, fallback: unknown) => stored.get(key) ?? fallback,
			update: async (key: string, value: unknown) => {
				stored.set(key, value);
			},
		} as unknown as vscode.Memento;
		const calibration = new TokenCalibration(state);
		const key = calibrationKey("https://test", "openai", "model::a", DEFAULT_TOKEN_ESTIMATION);
		for (let i = 0; i < 19; i++) {
			await calibration.observe(key, 100, 500, true);
		}
		assert.strictEqual(calibration.multiplier(key, "adaptive"), 1);
		await calibration.observe(key, 100, 500, false);
		assert.strictEqual(calibration.multiplier(key, "adaptive"), 1);
		await calibration.observe(key, 100, 500, true);
		assert.strictEqual(calibration.multiplier(key, "observe"), 1);
		assert.strictEqual(calibration.multiplier(key, "adaptive"), 2);
		assert.strictEqual(new TokenCalibration(state).multiplier(key, "adaptive"), 2);
		assert.notStrictEqual(key, calibrationKey("https://other", "openai", "model::a", DEFAULT_TOKEN_ESTIMATION));
		assert.notStrictEqual(key, calibrationKey("https://test", "openai", "model::b", DEFAULT_TOKEN_ESTIMATION));
	});

	test("nested Vision Bridge uses cached descriptions and never mutates the source", async () => {
		const originalConfig = vscode.workspace.getConfiguration;
		const originalSelect = vscode.lm.selectChatModels;
		const models = [
			{ id: "text", vision: false, owned_by: "test" },
			{ id: "vision", vision: true, owned_by: "test" },
		];
		let calls = 0;
		vscode.workspace.getConfiguration = (() => ({
			get: (key: string, fallback: unknown) => (key === "oaicopilot.models" ? models : fallback),
		})) as typeof originalConfig;
		vscode.lm.selectChatModels = (async () => [
			{
				id: "vision",
				sendRequest: async () => {
					calls++;
					return {
						text: (async function* () {
							yield "white page";
						})(),
					};
				},
			},
		]) as unknown as typeof originalSelect;
		const input = [imageResult("a", png(123, 456))];
		const token = { isCancellationRequested: false } as vscode.CancellationToken;
		try {
			assert.strictEqual(messagesContainImages(input), true);
			const output = await processMessagesForVision(input, "text", token);
			assert.strictEqual(messagesContainImages(output), false);
			assert.strictEqual(messagesContainImages(input), true);
			await processMessagesForVision(input, "text", token);
			assert.strictEqual(calls, 1);
			const data = (input[0].content[0] as vscode.LanguageModelToolResultPart)
				.content[0] as vscode.LanguageModelDataPart;
			assert.ok(getCachedVisionDescription(data, "text", models)?.includes("white page"));
			await assert.rejects(
				processMessagesForVision(input, "text", { isCancellationRequested: true } as vscode.CancellationToken),
				/cancelled/
			);
			const omitted = prepareMessagesForApi(input, { imageMode: "omit" });
			assert.strictEqual(messagesContainImages(omitted), false);
			assert.ok(JSON.stringify(omitted).includes("image omitted"));
			vscode.lm.selectChatModels = (async () => [
				{
					id: "vision",
					sendRequest: async () => {
						throw new Error("bridge unavailable");
					},
				},
			]) as unknown as typeof originalSelect;
			await assert.rejects(
				processMessagesForVision([imageResult("b", png(124, 457))], "text", token),
				/bridge unavailable/
			);
		} finally {
			vscode.workspace.getConfiguration = originalConfig;
			vscode.lm.selectChatModels = originalSelect;
		}
	});
});

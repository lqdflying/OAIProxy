import * as assert from "assert";
import * as vscode from "vscode";
import { AnthropicApi } from "../anthropic/anthropicApi";
import type { HFModelItem } from "../types";

suite("anthropicApi", () => {
	test("maps MiniMax M3 video data parts to Anthropic video blocks", () => {
		const api = new AnthropicApi("MiniMax-M3");
		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.User,
					name: undefined,
					content: [
						new vscode.LanguageModelTextPart("Describe this clip."),
						new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "video/mp4"),
					],
				} as unknown as vscode.LanguageModelChatRequestMessage,
			],
			{ includeReasoningInRequest: false }
		);

		const content = messages[0].content as unknown as Array<Record<string, unknown>>;
		assert.strictEqual(messages[0].role, "user");
		assert.deepStrictEqual(content[0], {
			type: "text",
			text: "Describe this clip.",
		});
		assert.deepStrictEqual(content[1], {
			type: "video",
			source: {
				type: "base64",
				media_type: "video/mp4",
				data: "AQID",
			},
		});
	});

	test("maps Claude Sonnet 4.6 effort to Anthropic adaptive thinking", () => {
		const api = new AnthropicApi("claude-sonnet-4-6");
		const body = api.prepareRequestBody(
			{
				model: "claude-sonnet-4-6",
				messages: [],
				stream: true,
			},
			model({
				id: "claude-sonnet-4-6",
				owned_by: "anthropic",
				apiMode: "anthropic",
				reasoning_effort: "medium",
			})
		);

		assert.deepStrictEqual(body.output_config, { effort: "medium" });
		assert.deepStrictEqual(body.thinking, { type: "adaptive" });
	});
});

function model(overrides: Partial<HFModelItem>): HFModelItem {
	return {
		id: "model",
		owned_by: "provider",
		...overrides,
	};
}

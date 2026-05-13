import * as vscode from "vscode";
import { LanguageModelResponsePart2 } from "vscode";

type LanguageModelThinkingPartCtor = new (
	value: string | string[],
	id?: string,
	metadata?: Readonly<Record<string, unknown>>
) => { value: string | string[]; id?: string; metadata?: Readonly<Record<string, unknown>> };

function getLanguageModelThinkingPartCtor(): LanguageModelThinkingPartCtor | undefined {
	const candidate = (vscode as unknown as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
	return typeof candidate === "function" ? (candidate as LanguageModelThinkingPartCtor) : undefined;
}

export function isLanguageModelThinkingPart(part: unknown): part is { value: string | string[] } {
	const ThinkingPart = getLanguageModelThinkingPartCtor();
	return ThinkingPart !== undefined && part instanceof ThinkingPart;
}

export function createLanguageModelThinkingPart(value: string | string[], id?: string): LanguageModelResponsePart2 {
	const ThinkingPart = getLanguageModelThinkingPartCtor();
	if (ThinkingPart) {
		return new ThinkingPart(value, id) as LanguageModelResponsePart2;
	}

	const text = Array.isArray(value) ? value.join("") : value;
	return new vscode.LanguageModelTextPart(text);
}

export function getLanguageModelThinkingText(part: { value: string | string[] }): string {
	return Array.isArray(part.value) ? part.value.join("") : part.value;
}

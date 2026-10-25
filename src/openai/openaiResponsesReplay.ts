import type { ResponsesInputItem, ResponsesReasoning } from "./openaiResponsesApi";
import { getLanguageModelThinkingMetadata, isLanguageModelThinkingPart } from "../vscodeCompat";

export const OPENAI_RESPONSES_REPLAY_METADATA = "oaiproxyOpenAIResponsesReplay";

// Only opaque reasoning and output ordering are retained. Visible text and tool
// arguments always come from the caller's current history, including its edits.
export type ResponsesReplayItem =
	| (ResponsesReasoning & { id: string; encrypted_content: string })
	| { type: "function_call"; call_id: string }
	| { type: "message" };

export function readResponsesReplayItem(value: unknown): ResponsesReplayItem | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const item = value as Record<string, unknown>;
	if (item.type === "function_call" && typeof item.call_id === "string" && item.call_id) {
		return { type: "function_call", call_id: item.call_id };
	}
	if (item.type === "message") {
		return { type: "message" };
	}
	if (
		item.type !== "reasoning" ||
		typeof item.id !== "string" ||
		!item.id ||
		typeof item.encrypted_content !== "string" ||
		!item.encrypted_content ||
		!Array.isArray(item.summary)
	) {
		return undefined;
	}
	const summary: ResponsesReasoning["summary"] = [];
	for (const part of item.summary) {
		if (!part || part.type !== "summary_text" || typeof part.text !== "string") {
			return undefined;
		}
		summary.push({ type: "summary_text", text: part.text });
	}
	return { type: "reasoning", id: item.id, encrypted_content: item.encrypted_content, summary };
}

/** Restore reasoning/tool order even when the host puts all tool calls after thinking parts. */
export function restoreResponsesReplay(
	parts: readonly unknown[],
	scope: string | undefined,
	visibleItems: ResponsesInputItem[]
): ResponsesInputItem[] | undefined {
	if (!scope) {
		return undefined;
	}
	const replay: ResponsesReplayItem[] = [];
	for (const part of parts) {
		if (!isLanguageModelThinkingPart(part)) {
			continue;
		}
		const envelope = getLanguageModelThinkingMetadata(part)?.[OPENAI_RESPONSES_REPLAY_METADATA];
		if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
			continue;
		}
		const record = envelope as Record<string, unknown>;
		if (record.version !== 1 || record.scope !== scope || !Array.isArray(record.output)) {
			continue;
		}
		for (const item of record.output) {
			const parsed = readResponsesReplayItem(item);
			if (parsed) {
				replay.push(parsed);
			}
		}
	}
	if (!replay.some((item) => item.type === "reasoning")) {
		return undefined;
	}

	const result: ResponsesInputItem[] = [];
	const used = new Set<ResponsesInputItem>();
	const reasoningIds = new Set<string>();
	for (const item of replay) {
		if (item.type === "reasoning") {
			if (!reasoningIds.has(item.id)) {
				reasoningIds.add(item.id);
				result.push(item);
			}
		} else {
			const visible = visibleItems.find(
				(candidate) =>
					!used.has(candidate) &&
					(item.type === "function_call"
						? candidate.type === "function_call" && candidate.call_id === item.call_id
						: "role" in candidate && candidate.role === "assistant")
			);
			if (visible) {
				used.add(visible);
				result.push(visible);
			}
		}
	}
	// Summary-only thinking would duplicate the summary on the opaque item.
	return [...result, ...visibleItems.filter((item) => item.type !== "reasoning" && !used.has(item))];
}

import type { CacheUsageSummary } from "./promptCache";

export type CacheUsageStatus = "hit" | "miss" | "reported";

export interface CacheUsageRecord extends CacheUsageSummary {
	apiMode: string;
	modelId: string;
	observedAt: string;
	cacheHitTokens?: number;
	cacheEligibleTokens?: number;
	cacheHitRate?: number;
	status: CacheUsageStatus;
}

export type CacheUsageListener = (record: CacheUsageRecord) => void;

const latestByModel = new Map<string, CacheUsageRecord>();
const listeners = new Set<CacheUsageListener>();
let latestRecord: CacheUsageRecord | undefined;

export function recordCacheUsage(apiMode: string, modelId: string, summary: CacheUsageSummary): CacheUsageRecord {
	const cacheHitTokens = getCacheHitTokens(summary);
	const cacheEligibleTokens = getCacheEligibleTokens(summary, cacheHitTokens);
	const cacheHitRate =
		cacheHitTokens !== undefined && cacheEligibleTokens !== undefined && cacheEligibleTokens > 0
			? cacheHitTokens / cacheEligibleTokens
			: undefined;
	const record: CacheUsageRecord = {
		...summary,
		apiMode,
		modelId,
		observedAt: new Date().toISOString(),
		cacheHitTokens,
		cacheEligibleTokens,
		cacheHitRate,
		status: getCacheUsageStatus(cacheHitTokens),
	};

	latestRecord = record;
	latestByModel.set(modelId, record);
	for (const listener of listeners) {
		listener(record);
	}
	return record;
}

export function getLatestCacheUsage(modelId?: string): CacheUsageRecord | undefined {
	if (modelId) {
		return latestByModel.get(modelId);
	}
	return latestRecord;
}

export function onDidChangeCacheUsage(listener: CacheUsageListener): { dispose(): void } {
	listeners.add(listener);
	return {
		dispose: () => {
			listeners.delete(listener);
		},
	};
}

export function resetCacheUsageForTests(): void {
	latestByModel.clear();
	listeners.clear();
	latestRecord = undefined;
}

function getCacheHitTokens(summary: CacheUsageSummary): number | undefined {
	return firstNumber(
		summary.cachedTokens,
		summary.promptCacheHitTokens,
		summary.cacheReadInputTokens,
		summary.cachedContentTokenCount
	);
}

function getCacheEligibleTokens(summary: CacheUsageSummary, cacheHitTokens: number | undefined): number | undefined {
	if (summary.promptCacheHitTokens !== undefined || summary.promptCacheMissTokens !== undefined) {
		return (summary.promptCacheHitTokens ?? 0) + (summary.promptCacheMissTokens ?? 0);
	}

	if (summary.cacheReadInputTokens !== undefined || summary.cacheCreationInputTokens !== undefined) {
		return (summary.cacheReadInputTokens ?? 0) + (summary.cacheCreationInputTokens ?? 0);
	}

	return firstNumber(summary.inputTokens, summary.totalTokens, cacheHitTokens);
}

function getCacheUsageStatus(cacheHitTokens: number | undefined): CacheUsageStatus {
	if (cacheHitTokens === undefined) {
		return "reported";
	}
	return cacheHitTokens > 0 ? "hit" : "miss";
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
	return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

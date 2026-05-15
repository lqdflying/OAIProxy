import type { HFApiMode } from "./types";

export interface ProviderPreset {
	id: string;
	label: string;
	provider: string;
	baseUrl: string;
	apiMode: HFApiMode;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{
		id: "kimi",
		label: "Kimi (Moonshot AI)",
		provider: "kimi",
		baseUrl: "https://api.moonshot.ai/v1",
		apiMode: "openai",
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		apiMode: "openai",
	},
	{
		id: "minimax",
		label: "MiniMax (OpenAI)",
		provider: "minimax",
		baseUrl: "https://api.minimax.io/v1",
		apiMode: "openai",
	},
	{
		id: "minimax-anthropic",
		label: "MiniMax (Anthropic)",
		provider: "minimax-anthropic",
		baseUrl: "https://api.minimax.io/anthropic",
		apiMode: "anthropic",
	},
];

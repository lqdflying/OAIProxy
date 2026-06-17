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
		id: "openai",
		label: "OpenAI",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		apiMode: "openai",
	},
	{
		id: "litellm",
		label: "LiteLLM Proxy",
		provider: "litellm",
		baseUrl: "https://ai.nube.sh/api/v1",
		apiMode: "litellm",
	},
	{
		id: "anthropic",
		label: "Anthropic",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		apiMode: "anthropic",
	},
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
		id: "zai",
		label: "Z.AI / Zhipu AI",
		provider: "zai",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		apiMode: "openai",
	},
	{
		id: "mimo",
		label: "Xiaomi MiMo",
		provider: "mimo",
		baseUrl: "https://api.xiaomimimo.com/v1",
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
	{
		id: "gemini",
		label: "Google Gemini",
		provider: "google",
		baseUrl: "https://generativelanguage.googleapis.com",
		apiMode: "gemini",
	},
	{
		id: "ollama",
		label: "Ollama",
		provider: "ollama",
		baseUrl: "http://localhost:11434",
		apiMode: "ollama",
	},
];

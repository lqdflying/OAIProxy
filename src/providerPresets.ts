import type { HFApiMode } from "./types";

export interface ProviderPreset {
	id: string;
	label: string;
	provider: string;
	baseUrl: string;
	apiMode: HFApiMode;
	authMode?: "api-key" | "oauth";
	sortOrder?: number;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{
		id: "azure-foundry",
		label: "Azure Foundry",
		provider: "azure-foundry",
		baseUrl: "https://YOUR-RESOURCE-NAME.services.ai.azure.com/openai/v1",
		apiMode: "azure-foundry",
		sortOrder: -100,
	},
	{
		id: "xai-oauth",
		label: "xAI / Grok (OAuth)",
		provider: "xai",
		baseUrl: "https://cli-chat-proxy.grok.com/v1",
		apiMode: "openai-responses",
		authMode: "oauth",
		sortOrder: -90,
	},
	{
		id: "openai",
		label: "OpenAI (API key)",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		apiMode: "openai",
	},
	{
		id: "openai-oauth",
		label: "OpenAI OAuth (Codex)",
		provider: "openai-oauth",
		baseUrl: "https://chatgpt.com/backend-api/codex",
		apiMode: "openai-responses",
		authMode: "oauth",
		sortOrder: -89,
	},
	{
		id: "tokenrouter",
		label: "TokenRouter",
		provider: "tokenrouter",
		baseUrl: "https://api.tokenrouter.com/v1",
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
		id: "fireworks",
		label: "Fireworks AI",
		provider: "fireworks",
		baseUrl: "https://api.fireworks.ai/inference/v1",
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

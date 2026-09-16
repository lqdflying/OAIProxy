# Provider Settings Examples

These examples are VS Code `settings.json` snippets. Pick the provider file that matches the API key and endpoint you want to configure, then replace model IDs with the current IDs from that provider.

The provider IDs match OAIProxy's built-in presets:

| File | Provider ID | API Mode |
|---|---|---|
| `openai-responses.jsonc` | `openai` | `openai-responses` |
| `openai-chat-completions.jsonc` | `openai` | `openai` |
| `tokenrouter.jsonc` | `tokenrouter` | `openai` |
| `litellm.jsonc` | `litellm` | `litellm` |
| `anthropic.jsonc` | `anthropic` | `anthropic` |
| `kimi.jsonc` | `kimi` | `openai` |
| `deepseek.jsonc` | `deepseek` | `openai` |
| `fireworks.jsonc` | `fireworks` | `openai` |
| `zai-glm.jsonc` | `zai` | `openai` |
| `mimo.jsonc` | `mimo` | `openai` |
| `minimax-openai.jsonc` | `minimax` | `openai` |
| `minimax-anthropic.jsonc` | `minimax-anthropic` | `anthropic` |

Normal provider API keys are stored by the extension as `oaicopilot.apiKey.<provider>`, not inside these snippets. TokenRouter keys use `oaicopilot.apiKey.tokenrouter`; its usage row uses a separate Management Key stored as `oaicopilot.usageApiKey.tokenrouter` and queries the Management API self-wallet endpoint. Fireworks usage checks reuse the normal provider key. For OpenAI and Anthropic usage/cost checks, enter the separate admin key in the configuration UI's `Usage Key` field; it is stored separately as `oaicopilot.usageApiKey.<provider>`.

## LiteLLM / Nube

`litellm.jsonc` uses the gateway aliases `Kimi-K2.6`, `GLM-5.3-Flash`, `GLM-5.3`, `DeepSeek-V4.1-Flash`, and `Qwen3.8-27B`. Qwen uses its native 262,144-token context with a conservative 65,536-token output allowance. Removing retired Quick Setup cards does not change existing saved models.

For the four new presets, Nube probes on September 15, 2026 verified chat at each documented reasoning level, streaming with usage, and vision for the three vision-capable models. Required tool calling passed for GLM-5.3-Flash, GLM-5.3, and Qwen3.8-27B. DeepSeek-V4.1-Flash supports automatic tool selection with thinking, but the gateway rejects named or `required` tool choices while thinking is enabled. OAIProxy preserves the caller's tool choice. These short probes used 512–1,024 output-token caps; maximum context and output capacity were not exercised.

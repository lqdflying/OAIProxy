# Provider Settings Examples

These examples are VS Code `settings.json` snippets. Pick the provider file that matches the API key and endpoint you want to configure, then replace model IDs with the current IDs from that provider.

The provider IDs match OAIProxy's built-in presets:

| File | Provider ID | API Mode |
|---|---|---|
| `openai-responses.jsonc` | `openai` | `openai-responses` |
| `openai-chat-completions.jsonc` | `openai` | `openai` |
| `anthropic.jsonc` | `anthropic` | `anthropic` |
| `kimi.jsonc` | `kimi` | `openai` |
| `deepseek.jsonc` | `deepseek` | `openai` |
| `mimo.jsonc` | `mimo` | `openai` |
| `minimax-openai.jsonc` | `minimax` | `openai` |
| `minimax-anthropic.jsonc` | `minimax-anthropic` | `anthropic` |

Normal provider API keys are stored by the extension as `oaicopilot.apiKey.<provider>`, not inside these snippets. For OpenAI and Anthropic usage/cost checks, enter the separate admin key in the configuration UI's `Usage Key` field; it is stored separately as `oaicopilot.usageApiKey.<provider>`.

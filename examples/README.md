# Provider Settings Examples

These examples are VS Code `settings.json` snippets. Pick the provider file that matches the API key and endpoint you want to configure, then replace model IDs with the current IDs from that provider.

The provider IDs match OAIProxy's built-in presets:

| File | Provider ID | API Mode |
|---|---|---|
| `openai-responses.jsonc` | `openai` | `openai-responses` |
| `openai-chat-completions.jsonc` | `openai` | `openai` |
| `openai-compatible.jsonc` | `openai-compatible` | `openai-compatible` |
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

For the four new presets, Nube probes verified chat at each documented reasoning level, streaming with usage, and vision for the three vision-capable models. GLM-5.3 and GLM-5.3-Flash use the upstream vLLM default thinking mode, so OAIProxy omits explicit `thinking` fields; this keeps named tool calls compatible with the gateway. Required tool calling passed for GLM-5.3-Flash, GLM-5.3, and Qwen3.8-27B. DeepSeek-V4.1-Flash supports automatic tool selection with thinking, but the gateway rejects named or `required` tool choices while thinking is enabled. OAIProxy preserves the caller's tool choice and replays an empty `reasoning_content` field when a prior thinking turn produced no visible reasoning tokens. These short probes used 512–1,024 output-token caps; maximum context and output capacity were not exercised.

## OpenAI Compatible

`openai-compatible.jsonc` points at a generic gateway. Replace `https://YOUR-GATEWAY.example.com/v1` with your gateway URL (including `/v1` when it needs one), keep `apiMode: "openai-compatible"`, and store the key as `oaicopilot.apiKey.openai-compatible`.

Bounded probes on October 30, 2026 against one Codex-backed compatible gateway (short prompts, 16–512 output-token caps, no maximum-capacity testing):

- `gpt-6-astra` with `reasoning_effort: "xhigh"` streamed text, a `stop` finish reason and streamed usage; the same request with `temperature`/`top_p` was also accepted, so OAIProxy's sampling pruning for this family is conservative rather than required by this gateway.
- `gpt-6.1-sol` returned streamed usage with `prompt_tokens_details.cached_tokens`, confirming automatic caching.
- A repeated long prefix with an explicit `prompt_cache_key` reported cached tokens on the second call, confirming the gateway honors the routing hint OAIProxy derives.
- `gpt-5.5` returned HTTP 404 `model_not_found`: "Model gpt-5.5 targets GPT-5.5, which retired from Codex with ChatGPT sign-in on October 14, 2026." No GPT-5.5 Quick Setup card is shipped for this reason; on a Codex-backed gateway, add GPT-6.1 Sol or GPT-6 Luna through Manual Setup instead.

Bounded cache probes on November 19, 2026 against the same kind of gateway with `gpt-6.2-astra`, using the body OAIProxy's adapter produces (`reasoning_effort: "xhigh"`, `max_tokens: 128000`, streamed usage, 9,000–22,000-token prompts, no maximum-capacity testing):

- Stream chunk IDs start with `resp_`, so the gateway translates Chat Completions to the Responses API. Identical bodies returned `prompt_tokens` that differed by 0, about 4,380, or about 5,410 tokens: the gateway rotates upstream channels and some add their own instructions. A cache miss omits `prompt_tokens_details`.
- On the channels that add instructions, a `system` message stayed uncached on every request of a growing conversation: the uncached remainder was the added instructions plus the whole system prompt (9,079–9,191 tokens with a 3,160-token system prompt). The same prompt sent as `developer` left only the added instructions uncached (4,501–4,661 and 5,531–5,691 tokens). On a channel without added instructions a `system` prompt cached fully (119–199 tokens uncached).
- A new conversation's first request reused the cached tools and system prompt in 3 of 4 runs when it shared a `prompt_cache_key` with an earlier conversation. With a key that also covered the first user message, the first request reused the tools at most (0–34% cached).
- Appending one tool to an otherwise unchanged request produced one fully uncached request with the same key. The next request hit again, and returning to the earlier tool list reused its cache.
- 15 of 92 requests that repeated or extended an already cached prefix found none of that conversation's cache, with no change in the request.

Streaming usage and cache fields vary by gateway, so treat these results as one gateway's behavior rather than a contract.

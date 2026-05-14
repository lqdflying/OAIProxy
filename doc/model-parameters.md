# Model Parameters

All parameters support individual configuration for different models, providing highly flexible model tuning capabilities.

## Parameter Reference

| Parameter | Required | Type | Default | Description |
|---|---|---|---|---|
| `id` | yes | `string` | — | Model identifier |
| `owned_by` | yes | `string` | — | Model provider (alias: `provider`, `provide`) |
| `displayName` | no | `string` | — | Display name shown in the Copilot interface |
| `configId` | no | `string` | — | Configuration ID for multi-config setups (e.g. `glm-4.6::thinking`) |
| `family` | no | `string` | `OAIProxy` | Model family for system prompt selection |
| `baseUrl` | no | `string` | global `oaicopilot.baseUrl` | Model-specific base URL |
| `context_length` | no | `number` | `128000` | Context length supported by the model |
| `max_tokens` | no | `number` | `4096` | Max tokens to generate (range: [1, context_length]) |
| `max_completion_tokens` | no | `number` | — | Max tokens to generate (OpenAI new standard parameter) |
| `vision` | no | `boolean` | `false` | Whether the model supports vision capabilities |
| `temperature` | no | `number` | — | Sampling temperature (range: [0, 2]) |
| `top_p` | no | `number` | — | Top-p sampling (range: (0, 1]) |
| `top_k` | no | `number` | — | Top-k sampling (range: [1, ∞)) |
| `min_p` | no | `number` | — | Minimum probability threshold (range: [0, 1]) |
| `frequency_penalty` | no | `number` | — | Frequency penalty (range: [-2, 2]) |
| `presence_penalty` | no | `number` | — | Presence penalty (range: [-2, 2]) |
| `repetition_penalty` | no | `number` | — | Repetition penalty (range: (0, 2]) |
| `enable_thinking` | no | `boolean` | — | Enable model thinking/reasoning display (non-OpenRouter) |
| `thinking_budget` | no | `number` | — | Max token count for thinking chain output |
| `reasoning_effort` | no | `string` | — | Reasoning effort level (OpenAI configuration) |
| `supports_reasoning_effort` | no | `boolean` | — | Expose VS Code's per-model Thinking Effort control |
| `supported_reasoning_efforts` | no | `string[]` | varies | Supported effort values (DeepSeek: `high`,`max`; others: `minimal`..`max`) |
| `default_reasoning_effort` | no | `string` | — | Default Thinking Effort value in the model picker |
| `toolCalling` | no | `boolean` | `true` | Advertise tool calling support to VS Code |
| `headers` | no | `object` | — | Custom HTTP headers per request |
| `extra` | no | `object` | — | Extra request body parameters |
| `include_reasoning_in_request` | no | `boolean` | — | Include `reasoning_content` in assistant messages |
| `apiMode` | no | `string` | `openai` | API protocol: `openai`, `openai-responses`, `ollama`, `anthropic`, `gemini` |
| `delay` | no | `number` | global `oaicopilot.delay` | Per-model delay (ms) between consecutive requests |
| `useForCommitGeneration` | no | `boolean` | — | Use this model for Git commit message generation (not supported for `gemini`) |

## Detailed Parameter Descriptions

### `temperature`

Sampling temperature (range: [0, 2]). Controls the randomness of the model's output:
- **Lower values (0.0-0.3)**: More focused, consistent, and deterministic. Ideal for precise code generation, debugging, and tasks requiring accuracy.
- **Moderate values (0.4-0.7)**: Balanced creativity and structure. Good for architecture design and brainstorming.
- **Higher values (0.7-2.0)**: More creative and varied responses. Suitable for open-ended questions and explanations.
- **Best Practice**: Set to `0` to align with GitHub Copilot's default deterministic behavior for consistent code suggestions. Thinking-enabled models suggest `1.0` to ensure optimal performance of the thinking mechanism.

### `reasoning`

OpenRouter reasoning configuration object with the following options:
- `enabled`: Enable reasoning functionality (if not specified, will be inferred from effort or max_tokens)
- `effort`: Reasoning effort level (`high`, `medium`, `low`, `minimal`, `auto`)
- `exclude`: Exclude reasoning tokens from the final response
- `max_tokens`: Specific token limit for reasoning (Anthropic style, as an alternative to effort)

### `thinking`

Thinking configuration for Zai provider:
- `type`: Set to `"enabled"` to enable thinking, `"disabled"` to disable thinking

### `supported_reasoning_efforts`

Custom list of Thinking Effort values shown in the model picker dropdown. DeepSeek models default to `["high", "max"]`; other models default to `["minimal", "low", "medium", "high", "xhigh", "max"]`.

### `default_reasoning_effort`

Default Thinking Effort value pre-selected in the model picker. If not set, `reasoning_effort` or `reasoning.effort` is used as the default.

### `apiMode`

API protocol to use for this model:
- `"openai"` (default): `/chat/completions` with `Authorization: Bearer` header
- `"openai-responses"`: `/responses` with `Authorization: Bearer` header
- `"ollama"`: `/api/chat` with optional `Authorization: Bearer` header
- `"anthropic"`: `/v1/messages` with `x-api-key` header
- `"gemini"`: `/v1beta/models/{model}:streamGenerateContent?alt=sse` with `x-goog-api-key` header

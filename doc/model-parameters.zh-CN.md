# 模型参数

所有参数支持为不同模型单独配置，提供高度灵活的模型调优能力。

## 参数参考表

| 参数 | 必填 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | 是 | `string` | — | 模型标识符 |
| `owned_by` | 是 | `string` | — | 模型供应商（别名：`provider`、`provide`） |
| `displayName` | 否 | `string` | — | 在 Copilot 界面中显示的名称 |
| `configId` | 否 | `string` | — | 多配置场景的配置 ID（如 `glm-4.6::thinking`） |
| `family` | 否 | `string` | `OAIProxy` | 模型家族，用于系统提示词选择 |
| `baseUrl` | 否 | `string` | 全局 `oaicopilot.baseUrl` | 模型专属 Base URL |
| `context_length` | 否 | `number` | `128000` | 模型支持的上下文长度 |
| `max_tokens` | 否 | `number` | `4096` | 最大生成 token 数（范围：[1, context_length]） |
| `max_completion_tokens` | 否 | `number` | — | 最大生成 token 数（OpenAI 新标准参数） |
| `vision` | 否 | `boolean` | `false` | 模型是否支持视觉能力 |
| `temperature` | 否 | `number` | — | 采样温度（范围：[0, 2]） |
| `top_p` | 否 | `number` | — | Top-p 采样（范围：(0, 1]） |
| `top_k` | 否 | `number` | — | Top-k 采样（范围：[1, ∞)） |
| `min_p` | 否 | `number` | — | 最小概率阈值（范围：[0, 1]） |
| `frequency_penalty` | 否 | `number` | — | 频率惩罚（范围：[-2, 2]） |
| `presence_penalty` | 否 | `number` | — | 存在惩罚（范围：[-2, 2]） |
| `repetition_penalty` | 否 | `number` | — | 重复惩罚（范围：(0, 2]） |
| `enable_thinking` | 否 | `boolean` | — | 启用模型思维链/推理内容显示（非 OpenRouter） |
| `thinking_budget` | 否 | `number` | — | 思维链输出的最大 token 数 |
| `reasoning_effort` | 否 | `string` | — | 推理力度级别（OpenAI 配置） |
| `supports_reasoning_effort` | 否 | `boolean` | — | 显示 VS Code 的按模型 Thinking Effort 控件 |
| `supported_reasoning_efforts` | 否 | `string[]` | 因模型而异 | 支持的力度值（DeepSeek：`high`,`max`；其他：`minimal`..`max`） |
| `default_reasoning_effort` | 否 | `string` | — | 模型选择器中的默认 Thinking Effort 值 |
| `toolCalling` | 否 | `boolean` | `true` | 向 VS Code 声明工具调用支持 |
| `headers` | 否 | `object` | — | 每次请求的自定义 HTTP 请求头 |
| `prompt_cache` | 否 | `object` | 安全自动 | Prompt/KV 缓存配置与命中统计 |
| `extra` | 否 | `object` | — | 额外请求体参数 |
| `extra_body` | 否 | `object` | — | LiteLLM 供应商/代理专用请求体参数 |
| `include_reasoning_in_request` | 否 | `boolean` | — | 在 assistant 消息中包含 `reasoning_content` |
| `apiMode` | 否 | `string` | `openai` | API 协议：`openai`、`litellm`、`openai-responses`、`ollama`、`anthropic`、`gemini` |
| `delay` | 否 | `number` | 全局 `oaicopilot.delay` | 连续请求之间的模型专属延迟（毫秒） |
| `useForCommitGeneration` | 否 | `boolean` | — | 是否用于 Git 提交信息生成（不支持 `gemini`） |

## 详细参数说明

### `temperature`

采样温度（范围：[0, 2]）。控制模型输出的随机性：
- **较低值（0.0-0.3）**：更集中、一致、确定。适合精确的代码生成、调试和需要准确性的任务。
- **中等值（0.4-0.7）**：平衡创造性和结构性。适合架构设计和头脑风暴。
- **较高值（0.7-2.0）**：更具创造性和多样性。适合开放式问题和解释。
- **最佳实践**：设为 `0` 以与 GitHub Copilot 的默认确定性行为保持一致，获得一致的代码建议。启用思维链的模型建议设为 `1.0` 以确保思维机制的最佳性能。

### `reasoning`

OpenRouter 推理配置对象，包含以下选项：
- `enabled`：启用推理功能（如不指定，将从 effort 或 max_tokens 推断）
- `effort`：推理力度级别（`high`、`medium`、`low`、`minimal`、`auto`）
- `exclude`：从最终响应中排除推理 token
- `max_tokens`：推理的特定 token 限制（Anthropic 风格，作为 effort 的替代方案）

### `thinking`

支持显式思维链模式的供应商配置：
- `type`：设为 `"enabled"` 开启思维链，`"disabled"` 关闭思维链，供应商支持时可设为 `"adaptive"`
- `clear_thinking`：Z.AI/GLM 兼容端点可设为 `false`，用于跨轮次保留历史 `reasoning_content`

小米 MiMo 在 OpenAI 兼容模式下使用同样的 `thinking.type` 请求体结构。对开启思维链的 MiMo agent/工具调用会话，请保持 `include_reasoning_in_request: true`，以便后续轮次继续传回历史 assistant 的 `reasoning_content`。

Z.AI GLM-5.2 编码 agent 会话建议同时使用 `reasoning_effort: "max"`、`thinking.type: "enabled"`、`thinking.clear_thinking: false` 和 `include_reasoning_in_request: true`，以便原样传回保留的思维链内容。GLM-5.2 支持的 effort 值为 `none`、`minimal`、`low`、`medium`、`high`、`xhigh` 和 `max`。

MiniMax M3 在 OpenAI 兼容模式和 Anthropic 兼容模式下都支持 `thinking.type: "adaptive"`。OpenAI 模式下可添加 `extra.reasoning_split: true`，将思维链与回答正文分离接收。

使用 `apiMode: "litellm"` 时，OAIProxy 会通过 LiteLLM 的字面量 `extra_body` 字段发送思维链控制。通用开关使用 `thinking.type`，供应商/LiteLLM 特定的思维链选项（如 `keep`）放入 `extra_body.thinking`。

### `supported_reasoning_efforts`

模型选择器下拉菜单中显示的自定义 Thinking Effort 值列表。DeepSeek 模型默认使用 `["high", "max"]`；其他模型默认使用 `["minimal", "low", "medium", "high", "xhigh", "max"]`。

### `default_reasoning_effort`

模型选择器中预选的默认 Thinking Effort 值。未设置时使用 `reasoning_effort` 或 `reasoning.effort` 作为默认值。

### `prompt_cache`

按供应商适配的 Prompt/KV 缓存配置：
- OpenAI 官方端点会自动添加稳定的 `prompt_cache_key`，除非设置 `prompt_cache.enabled: false`。可用 `prompt_cache.key` 覆盖 key，用 `prompt_cache.retention` 设置 `"in_memory"` 或 `"24h"`。
- Anthropic 兼容缓存写入需要显式启用。设置 `prompt_cache.anthropic.enabled: true` 后，会为稳定的 system prompt 和工具定义添加 `cache_control`；`ttl` 可为 `"5m"` 或 `"1h"`。显式的 VS Code `cache_control` 数据片段即使未启用该配置也会被保留。
- DeepSeek、小米 MiMo、MiniMax OpenAI 模式和 Gemini 使用供应商自动/隐式缓存。通过 `cache.usage` 日志查看实际命中情况。

### `apiMode`

此模型使用的 API 协议：
- `"openai"`（默认）：`/chat/completions`，使用 `Authorization: Bearer` 请求头。适用于 Kimi、DeepSeek、Z.AI GLM、小米 MiMo、MiniMax 等 OpenAI 兼容供应商。
- `"litellm"`：LiteLLM Proxy `/chat/completions`，使用 `Authorization: Bearer` 请求头。OAIProxy 会把思维链/推理的供应商选项映射到 `extra_body`。
- `"openai-responses"`：`/responses`，使用 `Authorization: Bearer` 请求头
- `"ollama"`：`/api/chat`，可选 `Authorization: Bearer` 请求头
- `"anthropic"`：`/v1/messages`，使用 `x-api-key` 请求头
- `"gemini"`：`/v1beta/models/{model}:streamGenerateContent?alt=sse`，使用 `x-goog-api-key` 请求头

MiniMax M3 可使用 `"openai"` 配合 `https://api.minimax.io/v1`，也可使用 `"anthropic"` 配合 `https://api.minimax.io/anthropic`。为 M3 设置 `vision: true`，即可直接转发图像输入和受支持的视频数据片段（`video/mp4`、`video/x-msvideo`、`video/quicktime`、`video/x-matroska`）。

### `extra_body`

LiteLLM Proxy 支持通过字面量 `extra_body` 请求字段传递供应商/代理专用参数。在 `apiMode: "litellm"` 中，可用 `extra_body` 设置 `reasoning_split`、`allowed_openai_params`、`drop_params`、`metadata`、`litellm_metadata` 或嵌套的供应商思维链选项。`extra` 仍用于顶层请求字段。

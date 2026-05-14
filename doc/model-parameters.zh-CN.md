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
| `extra` | 否 | `object` | — | 额外请求体参数 |
| `include_reasoning_in_request` | 否 | `boolean` | — | 在 assistant 消息中包含 `reasoning_content` |
| `apiMode` | 否 | `string` | `openai` | API 协议：`openai`、`openai-responses`、`ollama`、`anthropic`、`gemini` |
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

Zai 供应商的思维链配置：
- `type`：设为 `"enabled"` 开启思维链，`"disabled"` 关闭思维链

### `supported_reasoning_efforts`

模型选择器下拉菜单中显示的自定义 Thinking Effort 值列表。DeepSeek 模型默认使用 `["high", "max"]`；其他模型默认使用 `["minimal", "low", "medium", "high", "xhigh", "max"]`。

### `default_reasoning_effort`

模型选择器中预选的默认 Thinking Effort 值。未设置时使用 `reasoning_effort` 或 `reasoning.effort` 作为默认值。

### `apiMode`

此模型使用的 API 协议：
- `"openai"`（默认）：`/chat/completions`，使用 `Authorization: Bearer` 请求头
- `"openai-responses"`：`/responses`，使用 `Authorization: Bearer` 请求头
- `"ollama"`：`/api/chat`，可选 `Authorization: Bearer` 请求头
- `"anthropic"`：`/v1/messages`，使用 `x-api-key` 请求头
- `"gemini"`：`/v1beta/models/{model}:streamGenerateContent?alt=sse`，使用 `x-goog-api-key` 请求头

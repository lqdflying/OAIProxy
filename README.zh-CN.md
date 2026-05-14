<div align="center">

<img src="assets/logo.png" alt="OAIProxy Logo" width="120" height="120">

# OAIProxy

**自维护的 VS Code 扩展，用于在 GitHub Copilot Chat 中使用 OpenAI/Ollama/Anthropic/Gemini API 兼容供应商** 🔥

[English](README.md) | 简体中文

</div>

[![CI](https://github.com/lqdflying/OAIProxy/actions/workflows/release.yml/badge.svg)](https://github.com/lqdflying/OAIProxy/actions)
[![License](https://img.shields.io/github/license/lqdflying/OAIProxy?color=orange&label=License)](https://github.com/lqdflying/OAIProxy/blob/main/LICENSE)

## ✨ 特性
- **多 API 支持**：OpenAI/Ollama/Anthropic/Gemini API（ModelScope、SiliconFlow、DeepSeek 等）
- **视觉模型**：完整支持图像理解能力
- **高级配置**：灵活的对话请求选项，支持思维链/推理控制
- **多供应商管理**：同时配置多个供应商模型，自动管理各供应商 API 密钥
- **同模型多配置**：为同一模型定义不同参数配置（如 GLM-4.6 开启/关闭思维链）
- **可视化配置界面**：直观的界面管理供应商和模型
- **自动重试**：处理 API 错误（429、500、502、503、504），支持指数退避
- **Token 用量**：状态栏实时显示 token 计数和供应商 API 密钥管理
- **Git 集成**：使用 OpenAI/OpenAI Responses/Ollama/Anthropic 模型直接从源代码管理生成提交信息
- **导入/导出**：轻松分享和备份配置
- **工具优化**：对支持的流式工具调用优化 agent `read_file` 工具处理，避免对大文件读取小片段。

## 环境要求
- VS Code 1.120.0 或更高版本。
- OpenAI 兼容供应商的 API 密钥。

## ⚡ 快速开始
1. 安装 OAIProxy VSIX 包（`lqdflying.oaiproxy`）。
2. 打开 VS Code 设置，配置 `oaicopilot.baseUrl` 和 `oaicopilot.models`。
3. 打开 GitHub Copilot Chat 界面。
4. 点击模型选择器，选择 "Manage Models..."。
5. 选择 "OAIProxy" 供应商。
6. 输入你的 API 密钥——它将保存在本地。
7. 选择你想添加到模型选择器中的模型。

> 兼容性说明：OAIProxy 仍使用现有的 `oaicopilot.*` 设置键，因此已有 JSON 模型配置可以继续使用。由于扩展 ID 已改为 `lqdflying.oaiproxy`，VS Code 可能需要你在新扩展下重新输入一次 API Key。

### 配置示例

```json
"oaicopilot.baseUrl": "https://api-inference.modelscope.cn/v1",
"oaicopilot.models": [
    {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "owned_by": "modelscope",
        "context_length": 256000,
        "max_tokens": 8192,
        "temperature": 0,
        "top_p": 1
    }
]
```

## ✨ 配置界面

本扩展提供可视化配置界面，方便管理全局设置、供应商和模型，无需手动编辑 JSON 文件。

### 打开配置界面

有两种方式打开配置界面：

1. **通过命令面板**：
   - 按 `Ctrl+Shift+P`（macOS 上按 `Cmd+Shift+P`）
   - 搜索 "OAIProxy: Open Configuration UI"
   - 选择该命令打开配置面板

2. **通过状态栏**：
   - 点击 VS Code 右下角的 OAIProxy 状态栏项

<details>
<summary>点击展开详情</summary>

### 工作流示例

1. **添加供应商**：
   - 在供应商管理中点击 "Add Provider"
   - 输入供应商 ID："modelscope"
   - 输入 Base URL："https://api-inference.modelscope.cn/v1"
   - 输入 API Key：你的 ModelScope API 密钥
   - 选择 API 模式："openai"
   - 点击 "Save"

2. **添加模型**：
   - 在模型管理中点击 "Add Model"
   - 选择供应商："modelscope"
   - 输入模型 ID："Qwen/Qwen3-Coder-480B-A35B-Instruct"
   - 配置基本参数（上下文长度、最大 token 数等）
   - 点击 "Save Model"

3. **在 VS Code 中使用模型**：
   - 打开 GitHub Copilot Chat（`Ctrl+Shift+I` 或 `Cmd+Shift+I`）
   - 点击对话输入框的模型选择器
   - 选择 "Manage Models..."
   - 选择 "OAIProxy" 供应商
   - 选择已配置的模型
   - 开始与模型对话！

### 提示与最佳实践

- **重要**：如果使用配置界面，全局 baseURL 和 API 密钥将失效。
- **供应商 ID**：使用与服务匹配的描述性名称（如 "modelscope"、"iflow"、"anthropic"）
- **模型 ID**：使用供应商文档中的确切模型标识符
- **配置 ID**：多个配置使用有意义的名称，如 "thinking"、"no-thinking"、"fast"、"accurate"
- **Base URL 覆盖**：当同一供应商的不同模型来自不同端点时，设置模型专属 Base URL
- **及时保存**：更改会立即保存到 VS Code 设置中
- **刷新**：使用 "Refresh" 按钮从 VS Code 设置重新加载当前配置

### 模型家族与系统提示词

VS Code Copilot 针对特定模型优化了系统提示词。[详细介绍](https://github.com/microsoft/vscode-copilot-chat/blob/main/docs/prompts.md)

以下是 Copilot 支持的模型家族设置：

| 模型家族 | 通用 `family` | 具体模型 `family` | 备注 |
|---|---|---|---|
| Anthropic | 'claude', 'Anthropic'  | 'claude-sonnet-4-5', 'claude-haiku-4-5' |  |
| Gemini | 'gemini' | 'gemini-3-flash' | "github.copilot.chat.alternateGeminiModelFPrompt.enabled": true |
| xAI | 'grok-code' |  |  |
| OpenAI | 'gpt', 'o4-mini', 'o3-mini', 'OpenAI' | 'gpt-4.1', 'gpt-5-codex', 'gpt-5', 'gpt-5-mini', `!!family.startsWith('gpt-') && family.includes('-codex')`, `!!family.match(/^gpt-5\.\d+/i)` | "github.copilot.chat.alternateGptPrompt.enabled": true |

</details>

## ✨ 多 API 模式

本扩展支持五种不同的 API 协议，可与各种模型供应商对接。你可以通过 `apiMode` 参数为每个模型指定使用的 API 模式。

### 支持的 API 模式

1. **`openai`**（默认）- OpenAI Chat Completions API
   - 端点：`/chat/completions`
   - 请求头：`Authorization: Bearer <apiKey>`
   - 适用：大多数 OpenAI 兼容供应商（ModelScope、SiliconFlow 等）

2. **`openai-responses`** - OpenAI Responses API
   - 端点：`/responses`
   - 请求头：`Authorization: Bearer <apiKey>`
   - 适用：OpenAI 官方 Responses API（及兼容网关如 rsp4copilot）

3. **`ollama`** - Ollama 原生 API
   - 端点：`/api/chat`
   - 请求头：`Authorization: Bearer <apiKey>`（当存储的 API Key 恰好为 `ollama` 时省略）
   - 适用：本地 Ollama 实例

4. **`anthropic`** - Anthropic Claude API
   - 端点：`/v1/messages`
   - 请求头：`x-api-key: <apiKey>`
   - 适用：Anthropic Claude 模型

5. **`gemini`** - Gemini 原生 API
   - 端点：`/v1beta/models/{model}:streamGenerateContent?alt=sse`
   - 请求头：`x-goog-api-key: <apiKey>`
   - 适用：Google Gemini 模型（及兼容网关如 rsp4copilot）

<details>
<summary>点击展开详情</summary>

### 配置示例
多 API 模式混合配置：

```json
"oaicopilot.models": [
    {
        "id": "GLM-4.6",
        "owned_by": "modelscope",
    },
    {
        "id": "llama3.2",
        "owned_by": "ollama",
        "baseUrl": "http://localhost:11434",
        "apiMode": "ollama"
    },
    {
        "id": "claude-3-5-sonnet-20241022",
        "owned_by": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "apiMode": "anthropic"
    }
]
```

### 重要说明
- 未指定 `apiMode` 时默认为 `"openai"`。
- 使用 `ollama` 模式时，OAIProxy 仍需要保存一个 API Key 值。如果本地 Ollama 不需要认证，请使用 `ollama` 作为占位值，这样不会发送 `Authorization` 请求头；其他任意值都会作为 bearer token 发送。
- 每种 API 模式内部使用不同的消息转换逻辑，以匹配各自供应商的格式（工具、图像、思维链）。

</details>

## ✨ 多供应商指南

> 模型配置中的 `owned_by`（别名：`provider` / `provide`）用于分组供应商特定的 API 密钥。存储键为 `oaicopilot.apiKey.<providerId小写>`。

1. 打开 VS Code 设置，配置 `oaicopilot.models`。
2. 打开命令中心（Ctrl+Shift+P），搜索 "OAIProxy: Set OAIProxy Multi-Provider API Key" 来配置各供应商的 API 密钥。
3. 打开 GitHub Copilot Chat 界面。
4. 点击模型选择器，选择 "Manage Models..."。
5. 选择 "OAIProxy" 供应商。
6. 选择你想添加到模型选择器中的模型。

<details>
<summary>点击展开详情</summary>

### 配置示例

```json
"oaicopilot.baseUrl": "https://api-inference.modelscope.cn/v1",
"oaicopilot.models": [
    {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "owned_by": "modelscope",
        "context_length": 256000,
        "max_tokens": 8192,
        "temperature": 0,
        "top_p": 1
    },
    {
        "id": "qwen3-coder",
        "owned_by": "iflow",
        "baseUrl": "https://apis.iflow.cn/v1",
        "context_length": 256000,
        "max_tokens": 8192,
        "temperature": 0,
        "top_p": 1
    }
]
```

</details>

## ✨ 同模型多配置

你可以通过 `configId` 字段为同一个模型 ID 定义多个配置，实现同一基础模型针对不同场景使用不同的参数设置。

<details>
<summary>点击展开详情</summary>

使用方法：

1. 在模型配置中添加 `configId` 字段
2. 相同 `id` 的每个配置必须有不同的 `configId`
3. 模型将在 VS Code 模型选择器中显示为独立条目

### 配置示例

```json
"oaicopilot.models": [
    {
        "id": "glm-4.6",
        "configId": "thinking",
        "owned_by": "zai",
        "temperature": 0.7,
        "top_p": 1,
        "thinking": {
            "type": "enabled"
        }
    },
    {
        "id": "glm-4.6",
        "configId": "no-thinking",
        "owned_by": "zai",
        "temperature": 0,
        "top_p": 1,
        "thinking": {
            "type": "disabled"
        }
    }
]
```

上述示例中，你将可以在 VS Code 中使用 glm-4.6 模型的两种不同配置：
- `glm-4.6::thinking` - 使用 GLM-4.6 并开启思维链
- `glm-4.6::no-thinking` - 使用 GLM-4.6 并关闭思维链

</details>

## ✨ 自定义请求头

你可以指定自定义 HTTP 请求头，这些请求头会在每次请求特定模型的供应商时发送。适用于：

- API 版本控制请求头
- 自定义认证请求头（除标准 Authorization 请求头之外）
- 某些 API 要求的供应商特定请求头
- 请求追踪或调试请求头

<details>
<summary>点击展开详情</summary>

### 自定义请求头示例

```json
"oaicopilot.models": [
    {
        "id": "custom-model",
        "owned_by": "provider",
        "baseUrl": "https://api.example.com/v1",
        "headers": {
            "X-API-Version": "2024-01",
            "X-Request-Source": "vscode-copilot",
            "Custom-Auth-Token": "additional-token-if-needed"
        }
    }
]
```

**重要说明：**
- 自定义请求头与默认请求头（Authorization、Content-Type、User-Agent）合并
- 如果自定义请求头与默认请求头冲突，自定义请求头优先
- 请求头按模型粒度生效，可以为不同供应商设置不同的请求头
- 请求头的值必须是字符串

</details>

## ✨ 自定义请求体参数

`extra` 字段允许你向 API 请求体添加任意参数。适用于标准参数未覆盖的供应商特定功能。

### 工作原理
- `extra` 中的参数会直接合并到请求体中
- 适用于所有 API 模式（`openai`、`openai-responses`、`ollama`、`anthropic`、`gemini`）
- 值可以是任意合法的 JSON 类型（字符串、数字、布尔值、对象、数组）

<details>
<summary>点击展开详情</summary>

### 常见用例
- **OpenAI 特定参数**：`seed`、`logprobs`、`top_logprobs`、`suffix`、`presence_penalty`（如果不使用标准参数）
- **供应商特定功能**：自定义采样方法、调试标志
- **实验性参数**：API 供应商的 Beta 功能

### 配置示例

```json
"oaicopilot.models": [
    {
        "id": "custom-model",
        "owned_by": "openai",
        "extra": {
            "seed": 42,
            "logprobs": true,
            "top_logprobs": 5,
            "suffix": "###",
            "presence_penalty": 0.1
        }
    },
    {
        "id": "local-model",
        "owned_by": "ollama",
        "baseUrl": "http://localhost:11434",
        "apiMode": "ollama",
        "extra": {
            "keep_alive": "5m",
            "raw": true
        }
    },
    {
        "id": "claude-model",
        "owned_by": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "apiMode": "anthropic",
        "extra": {
            "service_tier": "standard_only"
        }
    }
]
```

### 在 Copilot 中显示思维链
以下是让 Copilot 显示 **Thinking** 模块的供应商特定参数（需要供应商/模型支持）。

#### OpenAI Responses
使用 `apiMode: "openai-responses"` 并设置推理摘要模式：

```json
{
  "id": "gpt-4o-mini",
  "owned_by": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiMode": "openai-responses",
  "reasoning_effort": "high",
  "extra": {
    "reasoning": {
      "summary": "detailed"
    }
  }
}
```

#### Gemini
使用 `apiMode: "gemini"` 并启用思维摘要：

```json
{
  "id": "gemini-3-flash-preview",
  "owned_by": "gemini",
  "baseUrl": "https://generativelanguage.googleapis.com",
  "apiMode": "gemini",
  "extra": {
    "generationConfig": {
      "thinkingConfig": {
        "includeThoughts": true
      }
    }
  }
}
```

### 重要说明
- `extra` 中的参数在标准参数之后添加
- 如果 `extra` 参数与标准参数冲突，`extra` 的值优先
- 仅用于供应商特定功能
- 标准参数（temperature、top_p 等）应尽可能使用其专用字段
- API 供应商必须支持你指定的参数

</details>

## 模型参数
所有参数支持为不同模型单独配置，提供高度灵活的模型调优能力。

- `id`（必填）：模型标识符
- `owned_by`（必填）：模型供应商
- `displayName`：在 Copilot 界面中显示的名称。
- `configId`：此模型的配置 ID。允许为同一模型定义不同设置（如 'glm-4.6::thinking'、'glm-4.6::no-thinking'）
- `family`：模型家族（如 'gpt-4'、'claude-3'、'gemini'）。启用模型特定的优化和行为。不指定时默认为 'oai-compatible'。
- `baseUrl`：模型专属 Base URL。未提供时使用全局 `oaicopilot.baseUrl`
- `context_length`：模型支持的上下文长度。默认为 128000
- `max_tokens`：最大生成 token 数（范围：[1, context_length]）。默认为 4096
- `max_completion_tokens`：最大生成 token 数（OpenAI 新标准参数）
- `vision`：模型是否支持视觉能力。默认为 false
- `temperature`：采样温度（范围：[0, 2]）。控制模型输出的随机性：
  - **较低值（0.0-0.3）**：更集中、一致、确定。适合精确的代码生成、调试和需要准确性的任务。
  - **中等值（0.4-0.7）**：平衡创造性和结构性。适合架构设计和头脑风暴。
  - **较高值（0.7-2.0）**：更具创造性和多样性。适合开放式问题和解释。
  - **最佳实践**：设为 `0` 以与 GitHub Copilot 的默认确定性行为保持一致，获得一致的代码建议。启用思维链的模型建议设为 `1.0` 以确保思维机制的最佳性能。
- `top_p`：Top-p 采样值（范围：(0, 1]）。可选参数
- `top_k`：Top-k 采样值（范围：[1, ∞)）。可选参数
- `min_p`：最小概率阈值（范围：[0, 1]）。可选参数
- `frequency_penalty`：频率惩罚（范围：[-2, 2]）。可选参数
- `presence_penalty`：存在惩罚（范围：[-2, 2]）。可选参数
- `repetition_penalty`：重复惩罚（范围：(0, 2]）。可选参数
- `enable_thinking`：启用模型思维链和推理内容显示（非 OpenRouter 供应商）
- `thinking_budget`：思维链输出的最大 token 数。可选参数
- `reasoning`：OpenRouter 推理配置，包含以下选项：
  - `enabled`：启用推理功能（如不指定，将从 effort 或 max_tokens 推断）
  - `effort`：推理力度级别（high、medium、low、minimal、auto）
  - `exclude`：从最终响应中排除推理 token
  - `max_tokens`：推理的特定 token 限制（Anthropic 风格，作为 effort 的替代方案）
- `thinking`：Zai 供应商的思维链配置
  - `type`：设为 'enabled' 开启思维链，'disabled' 关闭思维链
- `reasoning_effort`：推理力度级别（OpenAI 推理配置）
- `supports_reasoning_effort`：为此模型显示 VS Code 的按模型 Thinking Effort 控件。配置了 `reasoning_effort`、`reasoning.effort`、`default_reasoning_effort` 或 `supported_reasoning_efforts` 的模型也会自动显示该控件。
- `supported_reasoning_efforts`：支持的 Thinking Effort 取值。DeepSeek 默认使用 `high`、`max`；其他模型默认使用 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`。
- `default_reasoning_effort`：默认 Thinking Effort 值。未设置时使用 `reasoning_effort` 或 `reasoning.effort`。
- `toolCalling`：是否向 VS Code 声明此模型支持工具调用。Agent 模式需要保持 `true` 才会显示该模型。仅在非 Agent 聊天中想跳过 Agent optimized tool selection 时设为 `false`。
- `headers`：发送到此模型供应商的自定义 HTTP 请求头（如 `{"X-API-Version": "v1", "X-Custom-Header": "value"}`）。将与默认请求头（Authorization、Content-Type、User-Agent）合并
- `extra`：额外请求体参数。
- `include_reasoning_in_request`：是否在发送给 API 的 assistant 消息中包含 reasoning_content。支持 deepseek-v3.2 及类似模型。
- `apiMode`：API 模式：'openai'（默认）对应 API（/chat/completions），'openai-responses' 对应 API（/responses），'ollama' 对应 API（/api/chat），'anthropic' 对应 API（/v1/messages），'gemini' 对应 API（/v1beta/models/{model}:streamGenerateContent?alt=sse）。
- `delay`：连续请求之间的模型专属延迟（毫秒）。未指定时回退到全局 `oaicopilot.delay` 配置。
- `useForCommitGeneration`：是否用于 Git 提交信息生成。不支持 gemini apiMode。

## 日志

OAIProxy 会始终把扩展生命周期事件写入 VS Code Output 面板。打开 `Output: Show Output`，然后选择 `OAIProxy`。

如需请求和调试日志，在 VS Code 用户 Settings JSON 中添加：

```json
"oaicopilot.logLevel": "debug"
```

可选值为 `off`、`debug`、`info`、`warn`、`error`。文件日志写入 `~/.copilot/oaiproxy/logs/`。

## 致谢

感谢所有贡献者。

- [贡献者](https://github.com/lqdflying/OAIProxy/graphs/contributors)
- [Hugging Face Chat 扩展](https://github.com/huggingface/huggingface-vscode-chat)
- [VS Code Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)

## 支持 & 许可证
- 提交 Issue：https://github.com/lqdflying/OAIProxy/issues
- 许可证：MIT。原上游项目版权 Copyright (c) 2025 Johnny Zhao；OAIProxy 修改部分版权 Copyright (c) 2026 lqdflying。

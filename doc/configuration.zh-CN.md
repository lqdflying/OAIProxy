# 配置指南

## 配置界面

本扩展提供可视化配置界面，方便管理全局设置、供应商和模型，无需手动编辑 JSON 文件。

### 打开配置界面

有两种方式打开配置界面：

1. **通过命令面板**：
   - 按 `Ctrl+Shift+P`（macOS 上按 `Cmd+Shift+P`）
   - 搜索 "OAIProxy: Open Configuration UI"
   - 选择该命令打开配置面板

2. **通过状态栏**：
   - 点击 VS Code 右下角的 OAIProxy 状态栏项

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

---

## 多 API 模式

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

---

## 多供应商指南

> 模型配置中的 `owned_by`（别名：`provider` / `provide`）用于分组供应商特定的 API 密钥。存储键为 `oaicopilot.apiKey.<providerId小写>`。

1. 打开 VS Code 设置，配置 `oaicopilot.models`。
2. 打开命令中心（Ctrl+Shift+P），搜索 "OAIProxy: Set OAIProxy Multi-Provider API Key" 来配置各供应商的 API 密钥。
3. 打开 GitHub Copilot Chat 界面。
4. 点击模型选择器，选择 "Manage Models..."。
5. 选择 "OAIProxy" 供应商。
6. 选择你想添加到模型选择器中的模型。

### 配置示例

```json
"oaicopilot.baseUrl": "https://api-inference.modelscope.cn/v1",
"oaicopilot.models": [
    {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "owned_by": "modelscope",
        "context_length": 256000,
        "max_tokens": 8192
    },
    {
        "id": "qwen3-coder",
        "owned_by": "iflow",
        "baseUrl": "https://apis.iflow.cn/v1",
        "context_length": 256000,
        "max_tokens": 8192
    }
]
```

---

## 同模型多配置

你可以通过 `configId` 字段为同一个模型 ID 定义多个配置，实现同一基础模型针对不同场景使用不同的参数设置。

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
        "thinking": {
            "type": "enabled"
        }
    },
    {
        "id": "glm-4.6",
        "configId": "no-thinking",
        "owned_by": "zai",
        "thinking": {
            "type": "disabled"
        }
    }
]
```

上述示例中，你将可以在 VS Code 中使用 glm-4.6 模型的两种不同配置：
- `glm-4.6::thinking` - 使用 GLM-4.6 并开启思维链
- `glm-4.6::no-thinking` - 使用 GLM-4.6 并关闭思维链

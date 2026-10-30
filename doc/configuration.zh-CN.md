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
   - 可选：选择 "Kimi (Moonshot AI)"、"DeepSeek"、"Z.AI / Zhipu AI"、"Xiaomi MiMo" 或 "MiniMax" 等预设
   - 如果不使用预设，输入供应商 ID："modelscope"
   - 手动供应商请输入 Base URL："https://api-inference.modelscope.cn/v1"
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
- **供应商 ID**：使用与服务匹配的描述性名称（如 "modelscope"、"iflow"、"anthropic"、"kimi"、"deepseek"、"zai"、"mimo"、"minimax"）
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

本扩展支持多种 API 协议，可与各种模型供应商对接。你可以通过 `apiMode` 参数为每个模型指定使用的 API 模式。

### 支持的 API 模式

1. **`azure-foundry`** - Azure Foundry 直连 Chat Completions API
   - 端点：资源 `/openai/v1` Base URL 下的 `/chat/completions`
   - 请求头：`api-key: <apiKey>`
   - 用途：Azure Foundry 推理直连端点（不用于 Azure API Management 网关）

2. **`openai`**（默认）- OpenAI Chat Completions API
   - 端点：`/chat/completions`
   - 请求头：`Authorization: Bearer <apiKey>`
   - 适用：大多数 OpenAI 兼容供应商（Kimi、DeepSeek、Z.AI GLM、小米 MiMo、MiniMax、ModelScope、SiliconFlow 等）

3. **`openai-compatible`** - 通用 OpenAI 兼容网关（按 chathub 规则整形请求）
   - 端点：`/chat/completions`
   - 请求头：`Authorization: Bearer <apiKey>`
   - 适用：需要 chathub 请求整形规则的 OpenAI 兼容网关。只转发 `model`、`messages`、`stream`、`stream_options`、`max_tokens`、`reasoning_effort`、`stop`、`tools`、`tool_choice` 和采样字段；其他网关专属字段可以通过 `extra` 添加。对 `gpt-6-astra*` 与 `gpt-6.1-sol*` 去掉 `temperature`、`top_p`、`frequency_penalty` 和 `presence_penalty`。`max_completion_tokens` 以 `max_tokens` 发送，`prompt_cache` 会派生会话稳定的 `prompt_cache_key`。

4. **`litellm`** - LiteLLM Proxy Chat Completions API
   - 端点：`/chat/completions`
   - 请求头：`Authorization: Bearer <apiKey>`
   - 适用：需要通过字面量 `extra_body` 传递供应商/代理参数的 LiteLLM 代理端点

5. **`openai-responses`** - OpenAI Responses API
   - 端点：`/responses`
   - 请求头：`Authorization: Bearer <apiKey>`
   - 适用：OpenAI 官方 Responses API（及兼容网关如 rsp4copilot）

6. **`ollama`** - Ollama 原生 API
   - 端点：`/api/chat`
   - 请求头：`Authorization: Bearer <apiKey>`（当存储的 API Key 恰好为 `ollama` 时省略）
   - 适用：本地 Ollama 实例

7. **`anthropic`** - Anthropic Claude API
   - 端点：`/v1/messages`
   - 请求头：`x-api-key: <apiKey>`
   - 适用：Anthropic Claude 模型

8. **`gemini`** - Gemini 原生 API
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
- Azure Foundry 使用 `apiMode: "azure-foundry"`、直连的 `...services.ai.azure.com/openai/v1` 端点和 `api-key` 请求头；URL 与密钥在 Provider Management 中配置。
- LiteLLM Proxy 在需要通过字面量 `extra_body` 传递供应商参数时使用 `apiMode: "litellm"`。
- Fireworks、Kimi、DeepSeek、Z.AI GLM 和小米 MiMo 通过其 OpenAI 兼容的 Chat Completions API 使用 `apiMode: "openai"`。
- MiniMax 的 M 系列模型同时支持 `apiMode: "openai"` 和 `apiMode: "anthropic"`。MiniMax 推荐在 M3 思维链和交错思维工作流中使用 Anthropic 兼容端点。
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

### 供应商预设

配置界面可以为 OpenAI、OpenAI Compatible、TokenRouter、LiteLLM、Anthropic、Fireworks、Kimi、DeepSeek、Z.AI GLM、小米 MiMo 和 MiniMax 预填供应商设置。预设只填入供应商 ID、Base URL 和 API 模式；具体模型 ID 请另行按需添加。

| 供应商 | 供应商 ID | Base URL | API 模式 |
|---|---|---|---|
| OpenAI | `openai` | `https://api.openai.com/v1` | `openai` |
| OpenAI Compatible | `openai-compatible` | `https://YOUR-GATEWAY.example.com/v1` | `openai-compatible` |
| TokenRouter | `tokenrouter` | `https://api.tokenrouter.com/v1` | `openai` |
| Anthropic | `anthropic` | `https://api.anthropic.com` | `anthropic` |
| Kimi (Moonshot AI) | `kimi` | `https://api.moonshot.ai/v1` | `openai` |
| DeepSeek | `deepseek` | `https://api.deepseek.com` | `openai` |
| Fireworks AI | `fireworks` | `https://api.fireworks.ai/inference/v1` | `openai` |
| Z.AI / Zhipu AI | `zai` | `https://api.z.ai/api/coding/paas/v4` | `openai` |
| Xiaomi MiMo | `mimo` | `https://api.xiaomimimo.com/v1` | `openai` |
| MiniMax (OpenAI) | `minimax` | `https://api.minimax.io/v1` | `openai` |
| MiniMax (Anthropic) | `minimax-anthropic` | `https://api.minimax.io/anthropic` | `anthropic` |

配置示例见 `examples/openai-responses.jsonc`、`examples/openai-chat-completions.jsonc`、`examples/openai-compatible.jsonc`、`examples/tokenrouter.jsonc`、`examples/anthropic.jsonc`、`examples/fireworks.jsonc`、`examples/zai-glm.jsonc`、`examples/mimo.jsonc`、`examples/minimax-openai.jsonc` 和 `examples/minimax-anthropic.jsonc`。TokenRouter 使用 `https://api.tokenrouter.com/v1`，供应商 key 保存为 `oaicopilot.apiKey.tokenrouter`，Quick Setup 提供四个精确的网关模型 ID。Fireworks 用量检查复用普通供应商 key，并报告可访问账户的当月无服务器 token。OpenAI 和 Anthropic 的用量/费用检查需要单独的 admin key，请在配置界面的 `Usage Key` 字段中填写，不要写入 `settings.json`。TokenRouter 的余额检查需要在 `Usage Key` 字段填写单独的 Management Key，并通过 Management API self-wallet 端点报告账户余额。Z.AI 和小米 MiMo 用量检查会显示为不可用，因为当前公开文档未提供 API key 用量或余额端点。OpenAI Compatible 用量检查同样显示为不可用，因为通用网关没有固定的公开用量、余额或费用端点。

### OpenAI GPT-6.1 Sol

Quick Setup 提供独立的 **GPT-6.1 Sol** API key 卡片和 **GPT-6.1 Sol (OAuth)** 卡片。两者使用 `gpt-6.1-sol` 和 `openai-responses` 模式，启用视觉与工具调用，并将 `reasoning_effort` 和 `default_reasoning_effort` 设为 `xhigh`。可选推理值为 `low`、`medium`、`high`、`xhigh`、`max`，不支持 `none` 或 `minimal`。预设按照[官方模型规格](https://developers.openai.com/api/docs/models/gpt-6.1-sol)保存 `context_length: 1050000` 和 `max_tokens: 128000`。OpenAI 上游默认为 `medium`，OAIProxy 为这两张卡片明确选择 `xhigh`。

API key 卡片使用供应商 `openai` 和 `https://api.openai.com/v1`，并请求详细推理摘要。OAuth 卡片使用供应商及 `configId` `openai-oauth`、`authMode: "oauth"` 和 `https://chatgpt.com/backend-api/codex`，因此两份配置可以同时保留。[OAuth 访问](https://learn.chatgpt.com/docs/models#gpt-6.1-sol)取决于账户、推出进度和工作区设置。在供应商管理中，使用 **OpenAI OAuth (Codex)** 行的 **Sign in** 或命令 **OAIProxy: Sign in to OpenAI / Codex with OAuth** 完成设备码登录；凭据保存在 VS Code SecretStorage 中，并在请求前刷新。

公共 API 将输出额度发送为 `max_output_tokens`；OAuth 路由省略该字段，并遵循现有的 [Codex 请求要求](openai-oauth-cache.md)。

### OpenAI Compatible

`openai-compatible` 面向只提供 OpenAI Chat Completions 的通用网关。把占位 Base URL 换成网关地址（网关需要时包含 `/v1`），并把密钥保存为 `oaicopilot.apiKey.openai-compatible`。认证方式为 `Authorization: Bearer`，与 chathub 的兼容供应商一致。

请求整形遵循 chathub 的 `openaicompatible` 供应商：

- 请求体白名单为 `model`、`messages`、`stream`、`stream_options.include_usage`、`max_tokens`、`reasoning_effort`、`stop`、`tools`、`tool_choice`，以及模型支持时的 `temperature`、`top_p`、`frequency_penalty`、`presence_penalty`。供应商专属开关（`thinking`、`enable_thinking`、OpenRouter 风格的 `reasoning`、`top_k`、`min_p`、`repetition_penalty`）不会发送，除非通过 `extra` 显式添加。
- 对 `gpt-6-astra*` 和 `gpt-6.1-sol*` 去掉 `temperature`、`top_p`、`frequency_penalty`、`presence_penalty`，与 chathub 对这些模型族的裁剪规则一致。
- 已保存行中的 `max_completion_tokens` 会以 `max_tokens` 发送。
- `reasoning_effort` 始终以顶层字段发送。若某行只保存了 `reasoning.effort`，则使用该值，并且永远不会转发 OpenRouter 风格的 `reasoning` 对象。
- 启用 `prompt_cache.enabled: true` 或显式配置 `prompt_cache.retention` 时，OAIProxy 会根据模型、思考强度、工具选择与工具定义、所有 system/developer 消息和首条 user 消息派生会话稳定的 `prompt_cache_key`。显式 `prompt_cache.key` 优先；`prompt_cache.enabled: false` 则完全不发送该字段。配置了保留窗口时，会随密钥一起发送 `prompt_cache_retention`。

Quick Setup 提供一张卡片 **GPT-6 Astra**，使用 chathub 的兼容预算 `context_length: 258000` 和 `max_tokens: 128000`，默认 `xhigh`，可选 `low`/`medium`/`high`/`xhigh`/`max`。网关提供的其他模型请通过 Manual Setup 添加。该模式未实现 Responses 路由、`Session_id` 请求头、图像生成和视频透传。

### Fireworks AI

使用完整 Fireworks 模型 ID 和 `https://api.fireworks.ai/inference/v1` Base URL。内置 Quick Setup 卡片当前包括 `accounts/fireworks/models/deepseek-v4-pro`、`accounts/fireworks/models/kimi-k2p7-code` 和 `accounts/fireworks/models/glm-5p2`。

Fireworks 在上游默认启用 prompt caching。启用缓存时，OAIProxy 会发送稳定的 `user` affinity 值，并在后续请求中保留返回的 reasoning 内容。GLM-5.2 预设会在 VS Code 的 Thinking Effort 控件中提供 Fireworks 文档定义的 `none`、`high` 和 `max` 三种不同推理选项，并以 `max` 作为模型默认值。Provider Usage Check 使用公开 accounts 和 `billingUsage` API，并复用普通 Fireworks key。

### Z.AI GLM-5.2

`glm-5.2` 使用 Z.AI GLM Coding Plan 端点。Z.AI 官方文档列出 1,000,000 token 上下文窗口、131,072 最大输出 token、文本输入、思维链/推理支持、`reasoning_effort` 和工具调用。编码会话如需保留历史思维链，请同时设置 `reasoning_effort: "max"`、`thinking.clear_thinking: false` 和 `include_reasoning_in_request: true`。

```json
"oaicopilot.models": [
    {
        "id": "glm-5.2",
        "displayName": "GLM-5.2",
        "owned_by": "zai",
        "baseUrl": "https://api.z.ai/api/coding/paas/v4",
        "apiMode": "openai",
        "vision": false,
        "context_length": 1000000,
        "max_tokens": 131072,
        "reasoning_effort": "max",
        "supported_reasoning_efforts": ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
        "default_reasoning_effort": "max",
        "thinking": {
            "type": "enabled",
            "clear_thinking": false
        },
        "include_reasoning_in_request": true,
        "toolCalling": true
    }
]
```

### MiniMax M3

MiniMax M3 应使用精确模型 ID `MiniMax-M3`。MiniMax 官方文档列出 1,000,000 token 上下文窗口、工具调用、代码/Agent 工作流、自适应思维链，以及原生图像/视频输入。

需要 MiniMax 推荐的 M3 思维链路径时，使用 Anthropic 兼容预设：

```json
"oaicopilot.models": [
    {
        "id": "MiniMax-M3",
        "displayName": "MiniMax M3 (Anthropic)",
        "owned_by": "minimax-anthropic",
        "baseUrl": "https://api.minimax.io/anthropic",
        "apiMode": "anthropic",
        "vision": true,
        "context_length": 1000000,
        "max_tokens": 131072,
        "thinking": {
            "type": "adaptive"
        },
        "toolCalling": true
    }
]
```

需要 Chat Completions 兼容路径时，使用 OpenAI 兼容预设：

```json
"oaicopilot.models": [
    {
        "id": "MiniMax-M3",
        "displayName": "MiniMax M3",
        "owned_by": "minimax",
        "baseUrl": "https://api.minimax.io/v1",
        "apiMode": "openai",
        "vision": true,
        "context_length": 1000000,
        "max_completion_tokens": 131072,
        "thinking": {
            "type": "adaptive"
        },
        "extra": {
            "reasoning_split": true
        },
        "toolCalling": true
    }
]
```

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
    },
    {
        "id": "deepseek-v4-pro",
        "owned_by": "deepseek",
        "baseUrl": "https://api.deepseek.com",
        "apiMode": "openai"
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

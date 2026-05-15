# Configuration Guide

## Configuration UI

The extension provides a visual configuration interface that makes it easy to manage global settings, providers, and models without editing JSON files manually.

### Opening the Configuration UI

There are two ways to open the configuration interface:

1. **From the Command Palette**:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
   - Search for "OAIProxy: Open Configuration UI"
   - Select the command to open the configuration panel

2. **From the Status Bar**:
   - Click on the OAIProxy status bar item in the bottom-right corner of VS Code

### Workflow Example

1. **Add a Provider**:
   - Click "Add Provider" in the Provider Management section
   - Optionally choose a preset such as "Kimi (Moonshot AI)", "DeepSeek", or "MiniMax"
   - If you do not use a preset, enter Provider ID: "modelscope"
   - For a manual provider, enter Base URL: "https://api-inference.modelscope.cn/v1"
   - Enter API Key: Your ModelScope API key
   - Select API Mode: "openai"
   - Click "Save"

2. **Add a Model**:
   - Click "Add Model" in the Model Management section
   - Select Provider: "modelscope"
   - Enter Model ID: "Qwen/Qwen3-Coder-480B-A35B-Instruct"
   - Configure basic parameters (context length, max tokens, etc.)
   - Click "Save Model"

3. **Use the Model in VS Code**:
   - Open GitHub Copilot Chat (`Ctrl+Shift+I` or `Cmd+Shift+I`)
   - Click the model picker in the chat input
   - Select "Manage Models..."
   - Choose "OAIProxy" provider
   - Select your configured models
   - Start chatting with the model!

### Tips & Best Practices

- **Important**: If you use the configuration UI, the global baseURL and API key become invalid.
- **Provider IDs**: Use descriptive names that match the service (e.g., "modelscope", "iflow", "anthropic", "kimi", "deepseek", "minimax")
- **Model IDs**: Use the exact model identifier from the provider's documentation
- **Config IDs**: Use meaningful names like "thinking", "no-thinking", "fast", "accurate" for multiple configurations
- **Base URL Overrides**: Set model-specific base URLs when using models from different endpoints of the same provider
- **Save Frequently**: Changes are saved to VS Code settings immediately
- **Refresh**: Use the "Refresh" buttons to reload current configuration from VS Code settings

### Model family & System Prompts

VS Code Copilot has optimized system prompts for specific models. [Detailed introduction](https://github.com/microsoft/vscode-copilot-chat/blob/main/docs/prompts.md)

Below are the model family settings supported by Copilot:

| Model Family | General `family` | Specific Model `family` | Notes |
|---|---|---|---|
| Anthropic | 'claude', 'Anthropic'  | 'claude-sonnet-4-5', 'claude-haiku-4-5' |  |
| Gemini | 'gemini' | 'gemini-3-flash' | "github.copilot.chat.alternateGeminiModelFPrompt.enabled": true |
| xAI | 'grok-code' |  |  |
| OpenAI | 'gpt', 'o4-mini', 'o3-mini', 'OpenAI' | 'gpt-4.1', 'gpt-5-codex', 'gpt-5', 'gpt-5-mini', `!!family.startsWith('gpt-') && family.includes('-codex')`, `!!family.match(/^gpt-5\.\d+/i)` | "github.copilot.chat.alternateGptPrompt.enabled": true |

---

## Multi-API Mode

The extension supports five different API protocols to work with various model providers. You can specify which API mode to use for each model via the `apiMode` parameter.

### Supported API Modes

1. **`openai`** (default) - OpenAI Chat Completions API
   - Endpoint: `/chat/completions`
   - Header: `Authorization: Bearer <apiKey>`
   - Use for: Most OpenAI-compatible providers (Kimi, DeepSeek, MiniMax, ModelScope, SiliconFlow, etc.)

2. **`openai-responses`** - OpenAI Responses API
   - Endpoint: `/responses`
   - Header: `Authorization: Bearer <apiKey>`
   - Use for: OpenAI official Responses API (and compatible gateways like rsp4copilot)

3. **`ollama`** - Ollama native API
   - Endpoint: `/api/chat`
   - Header: `Authorization: Bearer <apiKey>` (omitted when the stored API key is exactly `ollama`)
   - Use for: Local Ollama instances

4. **`anthropic`** - Anthropic Claude API
   - Endpoint: `/v1/messages`
   - Header: `x-api-key: <apiKey>`
   - Use for: Anthropic Claude models

5. **`gemini`** - Gemini native API
   - Endpoint: `/v1beta/models/{model}:streamGenerateContent?alt=sse`
   - Header: `x-goog-api-key: <apiKey>`
   - Use for: Google Gemini models (and compatible gateways like rsp4copilot)

### Configuration Example

Mixed configuration with multiple API modes:

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

### Important Notes
- The `apiMode` parameter defaults to `"openai"` if not specified.
- Kimi, DeepSeek, and MiniMax use `apiMode: "openai"` through their OpenAI-compatible chat completions APIs.
- When using `ollama` mode, OAIProxy still needs a stored API key value. Use `ollama` as a placeholder for local Ollama if you do not want an `Authorization` header to be sent; any other value is sent as a bearer token.
- Each API mode uses different message conversion logic internally to match provider-specific formats (tools, images, thinking).

---

## Multi-Provider Guide

> `owned_by` (alias: `provider` / `provide`) in model config is used for grouping provider-specific API keys. The storage key is `oaicopilot.apiKey.<providerIdLowercase>`.

1. Open VS Code Settings and configure `oaicopilot.models`.
2. Open command center ( Ctrl+Shift+P ), and search "OAIProxy: Set OAIProxy Multi-Provider API Key" to configure provider-specific API keys.
3. Open GitHub Copilot Chat interface.
4. Click the model picker and select "Manage Models...".
5. Choose "OAIProxy" provider.
6. Select the models you want to add to the model picker.

### Provider Presets

The configuration UI can prefill provider settings for Kimi, DeepSeek, and MiniMax. Presets fill only the provider ID, base URL, and API mode; add the exact model IDs you want to use separately.

| Provider | Provider ID | Base URL | API Mode |
|---|---|---|---|
| Kimi (Moonshot AI) | `kimi` | `https://api.moonshot.ai/v1` | `openai` |
| DeepSeek | `deepseek` | `https://api.deepseek.com` | `openai` |
| MiniMax (OpenAI) | `minimax` | `https://api.minimax.io/v1` | `openai` |
| MiniMax (Anthropic) | `minimax-anthropic` | `https://api.minimax.io/anthropic` | `anthropic` |

### Settings Example

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

## Multi-config for the same model

You can define multiple configurations for the same model ID by using the `configId` field. This allows you to have the same base model with different settings for different use cases.

To use this feature:

1. Add the `configId` field to your model configuration
2. Each configuration with the same `id` must have a unique `configId`
3. The model will appear as separate entries in the VS Code model picker

### Settings Example

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

In this example, you'll have two different configurations of the glm-4.6 model available in VS Code:
- `glm-4.6::thinking` - use GLM-4.6 with thinking
- `glm-4.6::no-thinking` - use GLM-4.6 without thinking

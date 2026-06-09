# 自定义请求体参数

`extra` 字段允许你向 API 请求体添加任意参数。适用于标准参数未覆盖的供应商特定功能。

## 工作原理

- `extra` 中的参数会直接合并到请求体中
- 适用于所有 API 模式（`openai`、`litellm`、`openai-responses`、`ollama`、`anthropic`、`gemini`）
- 值可以是任意合法的 JSON 类型（字符串、数字、布尔值、对象、数组）
- 对于 `apiMode: "litellm"`，当 LiteLLM 要求供应商/代理参数位于字面量 `extra_body` 字段中时，请使用 `extra_body`。

## 常见用例

- **OpenAI 特定参数**：`seed`、`logprobs`、`top_logprobs`、`suffix`、`presence_penalty`（如果不使用标准参数）
- **供应商特定功能**：自定义采样方法、调试标志
- **实验性参数**：API 供应商的 Beta 功能

## 配置示例

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

## 在 Copilot 中显示思维链

以下是让 Copilot 显示 **Thinking** 模块的供应商特定参数（需要供应商/模型支持）。

### LiteLLM

通过 LiteLLM Proxy 路由时使用 `apiMode: "litellm"`。OAIProxy 会将 `thinking.type` 映射到 `extra_body.thinking.type`；其他 LiteLLM/供应商专用思维链选项请放入 `extra_body`。

```json
{
  "id": "kimi-k2.6",
  "owned_by": "litellm",
  "baseUrl": "https://ai.nube.sh/api/v1",
  "apiMode": "litellm",
  "thinking": {
    "type": "enabled"
  },
  "extra_body": {
    "thinking": {
      "keep": "all"
    }
  }
}
```

### OpenAI Responses

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

### Gemini

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

## 重要说明

- `extra` 中的参数在标准参数之后添加
- 如果 `extra` 参数与标准参数冲突，`extra` 的值优先
- 仅用于供应商特定功能
- 标准参数（temperature、top_p 等）应尽可能使用其专用字段
- API 供应商必须支持你指定的参数

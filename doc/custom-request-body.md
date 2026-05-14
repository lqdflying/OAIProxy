# Custom Request Body Parameters

The `extra` field allows you to add arbitrary parameters to the API request body. This is useful for provider-specific features that aren't covered by the standard parameters.

## How it works

- Parameters in `extra` are merged directly into the request body
- Works with all API modes (`openai`, `openai-responses`, `ollama`, `anthropic`, `gemini`)
- Values can be any valid JSON type (string, number, boolean, object, array)

## Common use cases

- **OpenAI-specific parameters**: `seed`, `logprobs`, `top_logprobs`, `suffix`, `presence_penalty` (if not using standard parameter)
- **Provider-specific features**: Custom sampling methods, debugging flags
- **Experimental parameters**: Beta features from API providers

## Configuration Example

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

## Show thinking in Copilot

These are provider-specific parameters that can make Copilot show a **Thinking** block (if the provider/model supports it).

### OpenAI Responses

Use `apiMode: "openai-responses"` and set the reasoning summary mode:

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

Use `apiMode: "gemini"` and enable thought summaries:

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

## Important Notes

- Parameters in `extra` are added after standard parameters
- If an `extra` parameter conflicts with a standard parameter, the `extra` value takes precedence
- Use this for provider-specific features only
- Standard parameters (temperature, top_p, etc.) should use their dedicated fields when possible
- API provider must support the parameters you specify

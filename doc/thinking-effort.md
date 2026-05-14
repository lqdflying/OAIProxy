# Thinking Effort Control

VS Code 1.120+ exposes a **Thinking Effort** dropdown in the model picker, allowing you to adjust how much reasoning the model performs — without editing your settings JSON.

OAIProxy surfaces this control automatically for any model that has a `reasoning_effort`, `reasoning.effort`, `default_reasoning_effort`, or `supported_reasoning_efforts` configured. DeepSeek models default to `high` and `max` values.

## How to enable Thinking Effort in the picker

Add `supports_reasoning_effort: true` to your model config, or set `supported_reasoning_efforts`:

```json
"oaicopilot.models": [
    {
        "id": "gpt-5-codex",
        "owned_by": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "apiMode": "openai-responses",
        "supports_reasoning_effort": true,
        "supported_reasoning_efforts": ["minimal", "low", "medium", "high", "xhigh", "max"],
        "default_reasoning_effort": "high",
        "reasoning_effort": "high",
        "extra": {
            "reasoning": {
                "summary": "detailed"
            }
        }
    },
    {
        "id": "deepseek-v3.2",
        "owned_by": "deepseek",
        "reasoning_effort": "high",
        "supports_reasoning_effort": true
    }
]
```

## New model fields

| Field | Type | Description |
|---|---|---|
| `supports_reasoning_effort` | `boolean` | Expose VS Code's per-model Thinking Effort control |
| `supported_reasoning_efforts` | `string[]` | Custom list of effort values shown in the dropdown |
| `default_reasoning_effort` | `string` | Pre-selected effort value when the model is first picked |

Models with `reasoning_effort`, `reasoning.effort`, or `default_reasoning_effort` also expose the control automatically.

## DeepSeek models

DeepSeek models (models whose ID or provider contains "deepseek") use a special effort mapping:
- `low`/`medium`/`high` → maps to `high`
- `xhigh`/`max` → maps to `max`

The picker shows only `high` and `max` for DeepSeek models by default.

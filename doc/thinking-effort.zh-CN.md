# 思维链力度控制

VS Code 1.120+ 在模型选择器中提供了 **Thinking Effort** 下拉菜单，允许你实时调整模型的推理力度——无需编辑 settings JSON。

OAIProxy 会自动为任何配置了 `reasoning_effort`、`reasoning.effort`、`default_reasoning_effort` 或 `supported_reasoning_efforts` 的模型显示此控件。DeepSeek 模型默认使用 `high` 和 `max` 两个等级。

## 如何在选择器中启用 Thinking Effort

在模型配置中添加 `supports_reasoning_effort: true`，或设置 `supported_reasoning_efforts`：

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

## 新增模型字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `supports_reasoning_effort` | `boolean` | 显示 VS Code 的按模型 Thinking Effort 控件 |
| `supported_reasoning_efforts` | `string[]` | 下拉菜单中显示的自定义力度值列表 |
| `default_reasoning_effort` | `string` | 初次选择模型时的预选力度值 |

配置了 `reasoning_effort`、`reasoning.effort` 或 `default_reasoning_effort` 的模型也会自动显示此控件。

## DeepSeek 模型

DeepSeek 模型（模型 ID 或供应商中包含 "deepseek"）使用特殊的力度映射：
- `low`/`medium`/`high` → 映射为 `high`
- `xhigh`/`max` → 映射为 `max`

选择器默认只为 DeepSeek 模型显示 `high` 和 `max` 两个选项。

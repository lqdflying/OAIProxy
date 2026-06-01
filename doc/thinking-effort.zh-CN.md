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
如果省略 `default_reasoning_effort`，OAIProxy 也会向 VS Code 提供安全的选择器默认值（可用时为 `medium`，Claude 为 `high`，否则使用第一个支持值），以便新版 VS Code 正常打开下拉菜单。

## DeepSeek 模型

DeepSeek 模型（模型 ID 或供应商中包含 "deepseek"）使用特殊的力度映射：
- `low`/`medium`/`high` → 映射为 `high`
- `xhigh`/`max` → 映射为 `max`

选择器默认只为 DeepSeek 模型显示 `high` 和 `max` 两个选项。

## Anthropic Claude 模型

Claude Sonnet 4.6、Claude Opus 4.6、Claude Opus 4.7、Claude Opus 4.5 和 Claude Mythos Preview 会自动显示该控件。OAIProxy 会把选择的值映射到 Anthropic 的 `output_config.effort`；对于 Claude Sonnet 4.6 等 adaptive thinking 模型，除非你显式关闭 thinking，否则还会发送 `thinking: { "type": "adaptive" }`。

Claude Sonnet 4.6 显示 `low`、`medium`、`high` 和 `max`。`xhigh` 只会为 Claude Opus 4.7 显示。

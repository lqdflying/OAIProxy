# 视觉桥接

OAIProxy 可以为纯文本模型自动描述图像。当模型配置为 `"vision": false`（默认值）时，聊天消息中的所有图像都会自动先发送到另一个配置了视觉能力的模型，然后将生成的文本描述替代原图像转发。

这意味着你可以在不支持原生视觉能力的模型中使用图像——当你偏好的编码模型缺乏视觉能力，但仍想分享截图或架构图时非常有用。

## 工作原理

1. 当聊天消息包含图像且目标模型 `"vision": false` 时，OAIProxy 会查找配置了 `"vision": true` 的模型。
2. 图像被发送到视觉模型，并使用提示词请求详细描述。
3. 描述作为文本注入到发送给纯文本模型的消息中。
4. 描述结果会被缓存（SHA-256 键 LRU 缓存，50 条 / ~500KB），在整个会话生命周期内有效。

## 配置示例

在纯文本模型旁边至少配置一个视觉能力模型：

```json
"oaicopilot.models": [
    {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "owned_by": "modelscope",
        "vision": false
    },
    {
        "id": "Qwen/Qwen2.5-VL-72B-Instruct",
        "owned_by": "modelscope",
        "vision": true
    }
]
```

在此设置下，发送到纯文本模型 `Qwen3-Coder` 的图像将被视觉模型 `Qwen2.5-VL` 自动描述。

## 要求

- 必须至少配置一个 `"vision": true` 的模型并且可用。
- 视觉模型必须在 OAIProxy 供应商下注册。

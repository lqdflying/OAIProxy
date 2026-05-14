# 自定义请求头

你可以指定自定义 HTTP 请求头，这些请求头会在每次请求特定模型的供应商时发送。适用于：

- API 版本控制请求头
- 自定义认证请求头（除标准 Authorization 请求头之外）
- 某些 API 要求的供应商特定请求头
- 请求追踪或调试请求头

## 配置示例

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

## 重要说明

- 自定义请求头与默认请求头（Authorization、Content-Type、User-Agent）合并
- 如果自定义请求头与默认请求头冲突，自定义请求头优先
- 请求头按模型粒度生效，可以为不同供应商设置不同的请求头
- 请求头的值必须是字符串

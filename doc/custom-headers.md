# Custom Headers

You can specify custom HTTP headers that will be sent with every request to a specific model's provider. This is useful for:

- API versioning headers
- Custom authentication headers (in addition to the standard Authorization header)
- Provider-specific headers required by certain APIs
- Request tracking or debugging headers

## Configuration Example

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

## Important Notes

- Custom headers are merged with default headers (Authorization, Content-Type, User-Agent)
- If a custom header conflicts with a default header, the custom header takes precedence
- Headers are applied on a per-model basis, allowing different headers for different providers
- Header values must be strings

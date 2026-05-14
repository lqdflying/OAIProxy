# Vision Bridge

OAIProxy can automatically describe images for text-only models. When a model has `"vision": false` set explicitly, any images in chat messages are automatically sent to a separately configured vision-capable model first, and the resulting text description is forwarded in place of the image.

> **Note**: You must explicitly set `"vision": false` to enable the bridge. Omitting the `vision` field will not trigger the bridge.

This means you can use images with models that don't natively support vision — useful when your preferred coding model lacks vision capabilities but you still want to share screenshots or diagrams.

## How it works

1. When a chat message contains an image and the target model has `"vision": false`, OAIProxy finds a configured model with `"vision": true`.
2. The image is sent to the vision model with a prompt asking for a detailed description.
3. The description is injected as text into the message sent to the text-only model.
4. Results are cached (SHA-256 keyed LRU, 50 entries / ~500KB) for the session lifetime.

## Configuration Example

Configure at least one vision-capable model alongside your text-only models:

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

With this setup, images sent to the text-only `Qwen3-Coder` model are automatically described by the vision-capable `Qwen2.5-VL` model.

## Requirements

- At least one model with `"vision": true` must be configured and available.
- The vision model must be registered under the OAIProxy provider.

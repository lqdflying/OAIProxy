# OpenAI OAuth (Codex) prompt-cache requirements

OpenAI OAuth uses the ChatGPT/Codex Responses route, which has different request requirements from the public OpenAI API-key Responses route. These rules apply only to models using `owned_by: "openai-oauth"`, `authMode: "oauth"`, `apiMode: "openai-responses"`, and the Codex base URL. Do not copy them to OpenAI API-key models or other providers.

## Request requirements

Use the Codex endpoint:

```text
https://chatgpt.com/backend-api/codex/responses
```

The OAuth request needs the normal bearer/account headers plus these Codex protocol headers:

```text
OpenAI-Beta: responses=experimental
Accept: text/event-stream
```

Every request in one conversation must also carry a stable conversation affinity value as both headers:

```text
session_id: <stable conversation key>
x-client-request-id: <the same stable conversation key>
```

The value must come from OAIProxy's stable Responses conversation state key. It must not be generated randomly for each request. These headers are the cache-routing signal used by the Codex backend.

The JSON body must follow the Codex Responses shape:

- Set `store` to `false`. The route rejects `store:true` or an omitted store setting.
- Include `reasoning.encrypted_content` in `include`.
- Omit unsupported public Responses fields: `context_management`, `metadata`, `max_output_tokens`, `temperature`, `top_p`, and `prompt_cache_retention`.
- Do not send `prompt_cache_key` in the Codex JSON body. Cache affinity is carried by `session_id` and `x-client-request-id`.
- Use easy-input replay items for text: `{ role: "user", content: "..." }` and `{ role: "assistant", content: "..." }`.
- For replayed reasoning, function-call, and function-call-output items, omit provider-generated `id` and `status` fields. Preserve the function `call_id` used to match tool results.

OAIProxy keeps the `previous_response_id` optimization, but the Codex route can reject it. On a client error, send the full conversation history and remember that the base URL does not support the optimization. A fallback request can still receive a prompt-cache hit.

## Why the cache can miss

The first request for a new conversation normally has no reusable prefix. Concurrent first requests can also race while populating the provider cache. The cache is provider-managed and best effort, so routing, machine locality, and TTL can produce an occasional miss even when the request is correct.

After warm-up, verify the returned usage instead of inferring a hit from latency. A real hit has `usage.prompt_tokens_details.cached_tokens` greater than zero and OAIProxy logs `cache.usage` with `status: "hit"`.

On September 26, 2026, the post-fix Astra log showed four warm-up misses followed by three consecutive hits:

```text
48,384 / 48,833 cached tokens (99.08%)
48,640 / 49,142 cached tokens (98.98%)
49,024 / 49,962 cached tokens (98.12%)
```

The same log showed `store:false`, `hasPromptCacheKey:false`, and both affinity flags true on each request.

## Debugging checklist

Inspect the newest VS Code Server extension-host log first, then the secondary JSONL log:

```bash
rg -n 'extension.lifecycle|request.start|request.headers|responses.codex.affinity|request.body|cache.usage|responses.state|request.error' \
  ~/.vscode-server/data/logs/*/exthost*/output_logging_*/*-OAIProxy.log
rg -n 'responses.codex.affinity|request.body|cache.usage|request.error' \
  ~/.copilot/oaiproxy/logs/oaiproxy-*.log
```

The expected sanitized summary contains:

- `responses.codex.affinity`: `hasSessionId:true`, `hasClientRequestId:true`, and a stable `sessionIdLength`.
- `request.body`: `store:false`, `hasPromptCacheKey:false`, and `hasMaxOutputTokens:false`.
- `cache.usage`: `cachedTokens > 0` and `status:"hit"` after warm-up.

The `request.headers` log is emitted before the conversation key is added, so it is not sufficient to prove the two affinity headers. Use `responses.codex.affinity` for their presence. Logs contain sanitized summaries rather than the raw body; do not claim a hidden field was sent when the summary does not show it.

Keep this behavior covered by the Codex-specific tests in `src/test/openaiOAuth.test.ts`, `src/test/openaiResponsesApi.test.ts`, and `src/test/promptCache.test.ts`. Changes must remain conditional on the OpenAI OAuth/Codex route so existing providers keep their current request and cache behavior.

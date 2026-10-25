# OpenAI OAuth (Codex) prompt-cache requirements

OpenAI OAuth uses the ChatGPT/Codex Responses route, which has different request requirements from the public OpenAI API-key Responses route. These rules apply only to models using `owned_by: "openai-oauth"`, `authMode: "oauth"`, `apiMode: "openai-responses"`, and the Codex base URL. Do not copy them to OpenAI API-key models or other providers.

## CLI usage attribution trial

OpenAI OAuth inference, device sign-in, token refresh, and quota requests send `originator: codex_cli_rs`, matching the default originator in the [official Codex CLI HTTP client](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs), inspected on October 1, 2026. The shared constant in `src/openaiOAuth.ts` also supplies the quota request in `src/providerUsage.ts`.

This trial changes only the originator. The `User-Agent` and `version` headers remain `oaiproxy`; credentials, endpoints, account attribution, and conversation/cache behavior stay the same. Inference requests retain `Accept: text/event-stream`; authentication and quota requests retain `Accept: application/json`.

The goal is to see whether new usage appears under CLI instead of Uncategorized. OpenAI's dashboard classification rules are not documented, and request-header tests cannot prove the displayed category. No historical reclassification is expected.

To verify after running the updated extension:

1. Send a short request with an OpenAI OAuth model and note its time. With debug logging enabled, confirm `originator: codex_cli_rs` in the sanitized `request.headers` entry in the VS Code Server OAIProxy output log.
2. After the dashboard records the new activity, check its usage category. A successful request alone does not confirm CLI attribution.
3. If new usage remains Uncategorized, record the trial as unsuccessful and reassess before changing additional CLI identity fields.

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

OAIProxy hashes the host's `_conversationId` together with the endpoint, model, configuration, account, and request initiator. If the host supplies no conversation ID, the first input is a best-effort anchor; two chats with identical first inputs cannot be distinguished in that fallback. Credentials without an account ID use a token fingerprint, so refreshing such a credential can rotate affinity. No raw credentials or conversation IDs enter these headers.

The affinity value stays stable when instructions, tools, or tool choice change. The stricter compatibility key for `previous_response_id` still checks those fields and the input prefix. Changing an account or conversation also isolates in-memory response state. Stable affinity supports cache routing; it does not guarantee a cache hit.

The JSON body must follow the Codex Responses shape:

- Set `store` to `false`. The route rejects `store:true` or an omitted store setting.
- Include `reasoning.encrypted_content` in `include`.
- Omit unsupported public Responses fields: `context_management`, `metadata`, `max_output_tokens`, `temperature`, `top_p`, and `prompt_cache_retention`.
- Do not send `prompt_cache_key` in the Codex JSON body. Cache affinity is carried by `session_id` and `x-client-request-id`.
- Use easy-input replay items for text: `{ role: "user", content: "..." }` and `{ role: "assistant", content: "..." }`.
- For reconstructed text, summary-only reasoning, function-call, and function-call-output items, omit fabricated `id` and `status` fields. Preserve the function `call_id` used to match tool results. An encrypted reasoning item is different: preserve its actual returned `id`, `encrypted_content`, and `summary`.

OAIProxy keeps the `previous_response_id` optimization, but the Codex route can reject it. On a matching 400/404 error, send the full conversation history. Unsupported-parameter failures disable the optimization for that endpoint/configuration/account scope; an expired or missing response ID does not. A fallback request can still receive a prompt-cache hit.

## Stateless reasoning continuation

With `store:false`, [OpenAI documents replaying encrypted reasoning items](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses) to continue reasoning without server-stored history. OAIProxy retains these items from item-done events or terminal response output in private VS Code thinking-part metadata. It restores their order around tool calls when history must be replayed. Tool arguments and visible text continue to come from the host's current history.

Opaque state is scoped to the conversation affinity identity and is replayed even when `includeReasoningInRequest` is disabled. That setting controls optional human-readable reasoning replay; encrypted continuation state is protocol data. The encrypted content is neither displayed nor written to provider logs. Failed or cancelled streams, and streams ending without a terminal response, do not emit new replay metadata. Hosts that discard thinking metadata cannot preserve this state through history.

This fixes lost state on tool continuations, not the wait on a fresh request. Reasoning effort, summary opt-in, Fast-tier mapping, and HTTP/SSE transport are unchanged. No live latency improvement or fresh warm-cache hit has been measured for this change.

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

- `responses.codex.affinity`: `hasSessionId:true`, `hasClientRequestId:true`, and `hasConversationId:true` when the host supplied an ID. `sessionIdLength` reports length only, not proof that two keys match.
- `request.body`: `store:false`, `hasPromptCacheKey:false`, and `hasMaxOutputTokens:false`. `encryptedReasoningItemCount` confirms opaque items are present in a full-history replay without exposing their content; a successful previous-response delta can legitimately have zero.
- `cache.usage`: `cachedTokens > 0` and `status:"hit"` after warm-up.

The `request.headers` log is emitted before the conversation key is added, so it is not sufficient to prove the two affinity headers. Use `responses.codex.affinity` for their presence. Logs contain sanitized summaries rather than the raw body; do not claim a hidden field was sent when the summary does not show it.

Keep this behavior covered by the Codex-specific tests in `src/test/openaiOAuth.test.ts`, `src/test/openaiResponsesApi.test.ts`, `src/test/openaiResponsesReplay.test.ts`, `src/test/openaiResponsesState.test.ts`, `src/test/providerOAuthContinuation.test.ts`, and `src/test/promptCache.test.ts`. Changes must remain conditional on the OpenAI OAuth/Codex route so existing providers keep their current request and cache behavior.

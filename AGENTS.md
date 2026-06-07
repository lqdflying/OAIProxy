# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Memory
- Before non-trivial work in this repo, also review `/home/opc/.codex/memories/oaiproxy.md` when available. Keep durable OAIProxy-specific workflow rules mirrored in this `AGENTS.md`; do not import unrelated memories from other projects.

## Build/Test/Lint Commands
```bash
npm run compile        # Build TypeScript
npm run watch          # Build in watch mode
npm run lint           # Run ESLint
npm run format         # Format with Prettier
npm run test           # Run tests (compile + vscode-test)
npm run build          # Package extension to .vsix
npm run download-api   # Download VS Code proposed API types (required after vscode.d.ts updates)
```

## Architecture
- **Entry**: `src/extension.ts` - registers `HuggingFaceChatModelProvider` under vendor id `oaicopilot`
- **Core Provider**: `src/provider.ts` - implements `LanguageModelChatProvider` interface
- **API Providers**: `src/openai/`, `src/ollama/`, `src/anthropic/`, `src/gemini/` - each handles provider-specific API

## Key Conventions
- Uses VS Code proposed API `chatProvider` - types in `src/vscode.proposed.*.d.ts`
- API keys stored via `vscode.SecretStorage` with keys `oaicopilot.apiKey` or `oaicopilot.apiKey.{provider}`
- Model config via `oaicopilot.models` setting (see `src/types.ts` for `HFModelItem`)
- Supports multi-provider: same model can have different `configId` for different settings
- Add Model UI design: keep Quick Setup as the default path with searchable/filterable checkbox preset cards from `src/modelPresets.ts`, plus Customize Preset and Manual Setup paths. Quick Setup must support multi-select Add Selected / Remove Selected actions with smart split behavior; Customize Preset is single-selection only. Preset cards should keep the VS Code button-blue treatment, use border-box sizing and inset selected/focus states so card edges do not overlap, and keep any direct Remove action adjacent to the Configured/Ready status. Configured preset cards must show a direct Remove action that reuses the normal delete confirmation flow. Manual Setup must continue to support all `HFModelItem` details for models not yet predefined. When updating predefined models, keep every preset save-ready with `providerPresetId`, `owned_by`, `baseUrl`, `apiMode`, `context_length`, and exactly one output token field (`max_tokens` or `max_completion_tokens`). Preserve provider-specific best-practice reasoning/thinking/tool/vision/prompt-cache fields, use `configId` when duplicate upstream model IDs would collide, and add/update tests in `src/test/modelPresets.test.ts`.
- The Language Models panel management command stores provider-specific keys for models with a custom `baseUrl` at `oaicopilot.apiKey.<owned_by>`. The generic key `oaicopilot.apiKey` is for models without a provider-specific `baseUrl`.
- VS Code 1.120+ Thinking Effort uses `LanguageModelChatInformation.configurationSchema` plus `options.modelConfiguration.reasoningEffort`.
- When adding a new provider or provider preset, check whether the provider offers an official usage/balance/cost API. If a public API-key endpoint exists, add the usage adapter, UI copy, tests, and docs in the same change; if not, document the unsupported reason and do not integrate private console/cookie endpoints.
- For test VSIX builds, keep the current package version. Do not bump `package.json`, `package-lock.json`, or add a release changelog entry unless the user explicitly says GA/release/version bump.
- `npm run build` intentionally uses system `npx` with a controlled `PATH` so `vsce` dependency detection uses real npm output. Do not use Bun's npm shim, plain `/usr/bin/npx`, or `--no-dependencies` for final VSIX builds; that can omit runtime dependencies such as `@microsoft/tiktokenizer`.
- Do not install, reinstall, or reload the OAIProxy VSIX from agent actions unless the user explicitly asks. Build/package the VSIX and let the user install/reload it. If a same-version test VSIX appears stale after install, advise uninstalling the existing extension first, then installing the VSIX again.
- For GA/release/version bump requests, complete the full GitHub release checklist before final response: bump `package.json` and `package-lock.json`, add a dated `CHANGELOG.md` entry, run compile/lint/relevant tests, run `npm run build`, commit and push the release changes, create and push tag `vX.Y.Z`, create a GitHub release with the matching `oaiproxy-X.Y.Z.vsix` asset, and verify the release asset uploaded. Use explicit release notes from the changelog/commit summary rather than only `--generate-notes`; do not start release notes with a duplicate H1 title. Do not publish to the VS Code Marketplace from agent actions; the maintainer publishes manually.
- If a release must be redone for the same version, delete the GitHub release and cleanup the tag, apply the fix, rebuild the VSIX, commit and push, recreate the tag at the corrected commit, push it, and recreate the release with explicit notes and the rebuilt asset.
- This repo is a VS Code extension commonly tested through remote VS Code Server. When asked to check plugin logs, inspect VS Code Server Output/Extension Host logs first under `~/.vscode-server/data/logs/<session>/exthost*/output_logging_*/N-OAIProxy.log`, `N-OAIProxy Usage.log`, and `remoteexthost.log`; use `~/.copilot/oaiproxy/logs/` only as a secondary cross-check.
- Do not infer hidden request fields from summarized debug logs. If a field such as reasoning effort, thinking type, or output config is not present in the log summary, treat the log as inconclusive and add safe summary fields instead of claiming the field was sent.
- When the user provides screenshot/image URLs, fetch the image locally and inspect it with `view_image`; do not infer UI details from the URL or filename alone.

## Code Style (from eslint.config.mjs)
- Semicolons required (`@stylistic/semi`)
- Curly braces required (`curly`)
- Unused vars with `_` prefix are ignored
- Use `\t` indentation (`@stylistic/indent`)
- Double quotes for strings (`@stylistic/quotes`)

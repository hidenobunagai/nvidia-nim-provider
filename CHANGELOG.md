# Change Log

## [0.3.3] - 2026-08-26

### Added

- **Pi sync script.** `scripts/sync-from-pi.ts` pulls the NVIDIA model table from Pi (`@earendil-works/pi-ai`'s `nvidia.json`, local install → CDN fallback) and checks it against `KNOWN_MODEL_OVERRIDES`. `bun run sync:pi` reports drift (exits 1, wired into CI), `bun run sync:pi:write` applies it. Pi-only values are rejected per-model via the `IGNORED` table (3 seeded: llama-3.1-8b ctx typo, gpt-oss-120b output cap below the 16K reasoning floor, cosmos-reason2-8b ctx — NVIDIA documents 256K).

### Changed

- **Catalog refreshed from Pi (50 field updates across 32 models):** `deepseek-ai/deepseek-v4-flash-0731` now 1M context / 384K max output (was 128K), `minimaxai/minimax-m3` 1M context, Llama 3.1/3.2/3.3 family 128K, vision flags for Kimi K2.6, MiniMax M3, Muse Glimmer, Gemma 3 4B/12B, Step 3.7 Flash, Inkling; per-model `maxOutputTokens` throughout (e.g. Llama 3.1 4K–8K, Kimi K2.6 256K, Nemotron 3 Super 256K).
- Bumped `MODELS_CACHE_VERSION` 5 → 6 so existing installs refresh their cached catalog.
- CI: `bun run sync:pi` drift check added (fails the build when the override table falls out of sync with Pi).

## [0.3.2] - 2026-08-22

### Added

- **New NVIDIA catalog models (2026-08-22 live check: 102 models).** Added overrides for 8 models missing from 0.3.1 that the live `/v1/models` endpoint now serves: **Moonshot Kimi K3** (1M context, vision, reasoning — 2.8T MoE, KDA/AttnRes, MoonViT-V2), **NVIDIA Cosmos Reason2 8B** (256K, vision, reasoning — Qwen3-VL-8B based), **Llama 3.2 1B/3B Instruct** (128K), **Llama3 ChatQA 1.5 70B** (8K) and **Writer Palmyra Fin/Med 70B** family (32K/8K). Without overrides these fell back to generic defaults (131K, non-vision) which broke token accounting and vision fallback.
- **Thinking model coverage:** `THINKING_MODELS` now matches `kimi-k\d` (covers K2, K2.6, K3) and `cosmos-reason*` so Kimi K3 and Cosmos Reason2 get the 16K output-budget floor and reasoning-only silent retries.

### Changed

- Bumped `MODELS_CACHE_VERSION` 4 → 5 so existing installs refresh their cached catalog and pick up the 8 new overrides.
- Docs: updated `docs/models.md` (new overrides table rows + reasoning families) for the current live catalog. Verified stale overrides (21 models no longer served, e.g. `z-ai/glm-5.2`, `deepseek-r1`, `anthropic/claude-*`) are retained for older accounts.

## [0.3.1] - 2026-08-15

### Changed

- **Adapter profiles as data.** The per-family adapter class hierarchy in `src/adapters/index.ts`
  was replaced with a plain profile table (same patterns, temperatures, and tool-use messages).
  Also removed the per-model adapter cache (14 regex matches per lookup are negligible) and the
  unused `parseTextEmbeddedToolCalls` hook.
- **Clean builds.** `bun run compile` now removes `out/` before compiling, so stale compiled files
  (e.g. `out/model-profile.js`, `out/mcp-compat.js` from earlier renames) no longer ship in the
  VSIX. This release's package is ~10 KB smaller.
- Removed dead code (`stripThinkTags` had no callers), a duplicated trailing-prefix finder in
  `utils.ts`, a duplicated `DEFAULT_MAX_TOKENS` constant, and the unused `jest-util`
  devDependency.

## [0.3.0] - 2026-08-15

### Added

- **Current NVIDIA catalog support.** The model catalog (`src/model-catalog.ts`) now ships overrides
  for the models currently served by the NVIDIA NIM API — DeepSeek V4 Flash, Kimi K2.6, GLM 5.2,
  GPT-OSS 120B/20B, MiniMax M3, Muse Glimmer 30B, Gemma 4 31B, Nemotron 3 (Nano/Super/Ultra),
  Llama 3.3 Nemotron Super 49B, Llama 3.1 Nemotron 51B, Mistral Large 2, and more — with display
  names, context windows and vision flags. The API no longer returns capability metadata, so these
  overrides keep the picker, token accounting and the vision fallback accurate.
- **Vision capability overrides.** VLM models (Llama 3.2 Vision, Nemotron Nano VL, Nemotron 3 Nano
  Omni, Nemotron Nano 12B V2 VL, Phi 3 Vision, VILA, NeVA, Fuyu, DePlot, Kosmos 2) are now
  recognized as vision-capable even without API metadata, fixing the image fallback and the
  `analyze_image` tool. Known non-tool VLMs (Fuyu, DePlot, Kosmos 2) are excluded from Agent mode.
- **Preferred vision fallback.** `findPreferredVisionModel` picks the best known VLM for the silent
  image fallback (Llama 3.2 Vision → Nemotron Nano VL → Nemotron 3 Nano Omni → Phi 3 Vision →
  VILA/NeVA) instead of whatever the API lists first.
- **Broader thinking-model coverage.** `THINKING_MODELS` now also matches DeepSeek V4, Kimi K2.x,
  GLM 5.x, GPT-OSS, MiniMax M3, Nemotron 3 and Nemotron Super, giving them the 16K output budget
  floor and silent reasoning-only retries previously reserved for DeepSeek R1/QwQ.
- **MiniMax adapter** with family-appropriate temperature defaults and tool-use guidance.
- **Stricter non-chat filtering.** Guard/safety models (nemoguard, llama-guard, content-safety),
  base/completion models (codegemma, codellama, starcoder2, llama2, gemma-2b, recurrentgemma),
  image generation (diffusiongemma), translation (riva-translate) and calibration models are now
  excluded from the model picker.
- Codestral models now use the Mistral family adapter.

### Changed

- Bumped `MODELS_CACHE_VERSION` to 4 so existing installations refresh their cached catalog and
  pick up the new overrides automatically.
- Updated `docs/models.md` and the README with the current catalog and reasoning model list.

## [0.2.3] - 2026-08-02

### Added

- **Truncated response retry.** When the model hits its output token budget mid-response (`finish_reason: "length"`), the extension now retries with a doubled budget instead of silently stopping mid-sentence. If retries are exhausted, a truncation warning is shown.
- **Action-announcement nudge.** When a model ends its turn by announcing an action ("テストを実行します。" / "I will run the tests.") without emitting the tool call, the buffered announcement is replayed as an assistant message and a nudge asks the model to emit the tool call it announced — within the existing retry budget.
- **System prompt guidance** (`guidance.ts`): tool-use grounding instructions ("never end your response by announcing an action", prefer parallel tool calls) and DeepSeek identity sanitization (replaces "Claude"/"Anthropic" with "GitHub Copilot"/"NVIDIA NIM").
- **Thinking-model output budget floor.** Reasoning models (DeepSeek R1, QwQ) get a minimum 16K `max_tokens` budget so internal reasoning cannot exhaust the budget before a visible response is produced.
- **Capture logs** for truncated and no-output responses: full attempt payloads are written to the output channel for replay against the API.
- **Documentation** (`docs/architecture.md`, `docs/models.md`, `docs/contributing.md`) and coverage measurement with a 50% threshold and CI artifact upload.

### Fixed

- **Severe token underestimation for Japanese/Chinese/Korean input.** CJK and full-width characters now count as ~1 token each (other characters ~1/2 token each), preventing over-limit requests from slipping through to the API and failing with 400 errors.
- **Unbounded `reasoningCache` growth.** The cache mapping message text to reasoning content is now a 50-entry LRU.
- **Chat history pollution from the vision model-switch notice.** "Switching to X for image analysis" is now logged to the debug channel only.
- **Incomplete text-embedded tool calls not being retried.** `hasVisibleOutput` now excludes buffered text tied to an incomplete tool call, and the tool-call scanner buffer is inspected so cut-off text-embedded calls are reliably retried.

### Changed

- **Module-private output channel** (replaced the `globalThis` singleton) with a new `captureLog` entry point.
- **SSE buffer safety cap** (1 MB) and a 120s request-level timeout on chat completions.
- **Retries are silent.** No `(Retrying...)` markers are written into the conversation history; details stay in the debug log.
- Added type guards (`hasTextValue`, `isToolResultPart`, `isToolCallPart`) in `message-parts.ts` and replaced `as` casts with them in `tool-repair.ts`.
- Removed no-op tokenizer preload/dispose functions.

## [0.2.1] - 2026-05-24

### Added

- Contributed `languageModelTools` configuration in `package.json` to properly declare the `nvidia_nim_analyze_image` tool for automatic discovery by VS Code Copilot Chat.
- Robust API key dynamic synchronization that automatically saves credentials configured in model settings or provider groups to SecretStorage, preventing prompt loops.
- Intelligent multi-tiered Vision fallbacks: automatic vision-capable model fallback switching, and asynchronous background OCR/description fallback (using the MCP image analysis client) for text-only models.

## [0.1.23] - 2026-04-27

### Changed

- Reduced chat hot-path overhead by collapsing message conversion into a single content pass and by avoiding no-op copies in the Kimi reasoning-content workaround.
- Deferred tool parsing state construction until a response actually needs tool handling, reducing unnecessary per-request work on plain text chats.
- Expanded debug stream timing logs with request-preparation and lazy tool-parsing initialization durations so latency tuning can distinguish setup cost from first-token delay.

## [0.1.22] - 2026-04-26

### Added

- Model profiles for Mistral/Mixtral, Qwen, Phi, Yi, and Gemma model families with per-family temperature defaults and tool-use system messages.
- Known model display-name overrides for Llama-4 Scout, Nemotron 4, Nemotron Ultra, Mistral Large, Mixtral 8x22B, Qwen 2.5 (72B/Coder 32B), Phi 3.5 Mini, Yi Large, and Gemma 2.
- Expanded VS Code mock for better test coverage (EventEmitter, CancellationError, Disposable, etc.).

### Changed

- Model-profile matching uses word-boundary regex instead of naive `includes()` to avoid false matches.
- Image analysis requests now use `fetchWithRetry` and include a User-Agent header.
- Token estimation is now character-type-aware (CJK vs. Latin) for better accuracy while retaining a safety margin.
- Unrecognized message parts log via the debug channel instead of `console.warn`.

## [0.1.21] - 2026-04-26

### Fixed

- Stop leaking split or truncated DSML and text-embedded tool-control markers into streamed chat text.
- Treat malformed text-embedded tool calls as invalid calls so the provider retries once with corrective guidance instead of echoing raw control tokens or silently dropping them.
- Prefer required-argument retry and fallback guidance when the model emits multiple invalid tool calls in a single response.

## [0.1.20] - 2026-04-26

### Fixed

- Exclude local development-only files such as `.venv`, tests, docs, and source TypeScript from the
  published VSIX so Marketplace installs only ship the runtime extension payload.

## [0.1.19] - 2026-04-26

### Fixed

- Retry NVIDIA model responses once when they emit a required-argument tool call such as
  `read_file` with an empty JSON object, so Copilot Chat can recover instead of immediately
  surfacing a retry error to the user.

## [0.1.18] - 2026-04-26

### Fixed

- Correctly treat VS Code's groupless provider resolution as groupless when the extension host
  passes `configuration: undefined`. This prevents the legacy `nvidia-nim/<model>` model set from
  being re-registered and shown alongside `nvidia-nim/NVIDIA NIM/<model>` in Manage Models.

## [0.1.17] - 2026-04-26

### Fixed

- Stop advertising the legacy groupless NVIDIA NIM model set now that the named provider group is
  restored. This removes the duplicate `nvidia-nim/<model>` and `nvidia-nim/NVIDIA NIM/<model>`
  rows from VS Code Manage Models.
- Keep the named NVIDIA NIM group working with either its configured API key or the legacy
  SecretStorage key fallback.

## [0.1.16] - 2026-04-26

### Fixed

- Treat VS Code provider-group resolutions that only include `configuration` as provider-group
  calls, so the NVIDIA row can resolve models even when VS Code does not pass a string group name.
- Keep the duplicate-picker guard from resetting during those configuration-only group calls.

## [0.1.15] - 2026-04-26

### Fixed

- Restore legacy groupless NVIDIA NIM model identifiers such as `nvidia-nim/<model>` so stale VS
  Code model selections remain backed by the NVIDIA provider instead of falling back to Copilot.
- Keep named NVIDIA NIM provider-group models resolvable while hiding them from the picker when the
  groupless legacy entries are already visible, preventing duplicate selectable rows.

## [0.1.14] - 2026-04-26

### Fixed

- Restore broken NVIDIA NIM Manage Models entries that exist without an `apiKey` by falling back to
  the legacy SecretStorage API key for named provider groups.
- Stop hiding duplicate provider groups by returning an empty model list. Duplicate model IDs now
  remain resolvable for existing chats but are marked non-selectable so the model picker does not
  show duplicate rows.
- Reintroduce one-time legacy key migration to avoid repeatedly creating or touching VS Code model
  groups on every startup.
- Filter obvious non-chat NVIDIA catalog entries and exact duplicate model IDs from the picker cache.

## [0.1.13] - 2026-04-27

### Fixed

- **Duplicate model display (root cause fixed)**: Replaced the API-key-based duplicate guard with a
  per-resolution-cycle flag. VS Code calls `provideLanguageModelChatInformation` once per provider
  group per cycle; the extension now returns models only for the first group call in each cycle and
  suppresses all subsequent calls — regardless of whether those groups share the same API key or use
  different keys. This eliminates the duplicate model picker entries that persisted through v0.1.11
  and v0.1.12.
- **Restore Manage Models entry on startup**: Reverted the one-time migration guard introduced in
  v0.1.12. `migrateLanguageModelProviderGroup` now runs on every startup when a legacy API key is
  present, so the NVIDIA NIM entry in VS Code's Manage Models is automatically recreated if it was
  accidentally removed.

## [0.1.12] - 2026-04-27

### Fixed

- **Duplicate model display (root cause)**: Legacy API key migration is now performed only once
  per installation. Previously the migration ran on every startup, which could create multiple
  NVIDIA NIM provider groups in VS Code's Manage Models system and cause every model to appear
  twice in the model picker.
- **Diagnostic logging**: The NVIDIA NIM output channel now logs each VS Code model resolution
  call with its call number and result count. When a duplicate provider group is detected, a
  actionable warning is written to the output channel explaining how to remove the extra entry
  via VS Code Settings → Manage Models.

### How to diagnose remaining duplicate models

Open the NVIDIA NIM output channel (`View → Output → NVIDIA NIM`) and look for lines starting
with `[NVIDIA NIM] resolution:`. A `⚠️ duplicate provider group detected` message means VS Code
is still invoking your provider more than once with the same API key. Open VS Code Settings
(⌘,), search "Manage Models", find NVIDIA NIM, and remove the extra entry.

## [0.1.11] - 2026-04-26

### Fixed

- Suppress duplicate model picker entries when multiple configured NVIDIA NIM provider groups use
  the same API key.

## [0.1.10] - 2026-04-25

### Fixed

- Avoid duplicate NVIDIA NIM model picker entries by only returning models for VS Code provider
  groups that supply an API key configuration.
- Keep legacy API keys available for migration and chat fallback without advertising a second
  unconfigured copy of every model.

## [0.1.9] - 2026-04-25

### Fixed

- Mark NVIDIA NIM models as user-selectable so Copilot Chat's model picker does not filter them out.
- Treat missing NVIDIA `/models` tool-calling metadata as unknown/supported instead of unsupported, so
  chat models are still available when Copilot Chat is in Agent mode.
- Refresh stale normalized model caches when VS Code model settings provide an API key, ensuring older
  caches written before this picker metadata fix are upgraded.

## [0.1.8] - 2026-04-25

### Fixed

- Automatically migrate API keys saved by the legacy `NVIDIA NIM: Manage NVIDIA NIM API Key`
  command into VS Code's language model provider group, so Copilot Chat's model picker resolves
  NVIDIA NIM models instead of only showing the provider in settings.
- Keep the legacy SecretStorage key as a fallback while wiring it into VS Code's model configuration
  flow.

## [0.1.7] - 2026-04-25

### Fixed

- Add the VS Code language model provider configuration schema for the NVIDIA NIM API key.
- Read API keys supplied by VS Code model settings when resolving picker models and chat requests.
- Remove the deprecated model provider `managementCommand` contribution so VS Code can create a
  configured NVIDIA NIM model group.

## [0.1.6] - 2026-04-25

### Fixed

- Fetch NVIDIA NIM models on demand when the Copilot Chat model picker asks for models before the
  background refresh has populated the cache.

## [0.1.5] - 2026-04-25

### Fixed

- Clear stale cached models when NVIDIA NIM `/models` successfully returns an empty list.
- Treat non-array persisted model cache values as malformed and return no picker models.
- Update image-analysis helper comments to reflect cached vision-model selection rather than fallback behavior.

## [0.1.4] - 2026-04-25

### Fixed

- Removed the copied OpenCode Go fallback model catalog. The model picker now relies on models
  discovered from NVIDIA NIM `/models` and returns no models until a normalized NVIDIA model cache
  exists.
- Updated README and Marketplace metadata so the extension no longer advertises copied OpenCode Go
  model names.

## [0.1.3] - 2026-04-25

### Added

- NVIDIA NIM Copilot Chat provider.
- Dynamic model discovery from `https://integrate.api.nvidia.com/v1/models`.
- OpenAI-compatible streaming chat completions through NVIDIA NIM.
- Tool calling and vision capability gating based on normalized NVIDIA model metadata.
- Secure NVIDIA API key storage via VS Code SecretStorage.
- Commands for managing the API key, refreshing models, and opening debug logs.

### Changed

- Project was rebranded from the reference implementation to NVIDIA NIM.

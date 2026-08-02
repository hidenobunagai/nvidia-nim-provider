# Model Reference

At runtime the extension fetches the available models from the NVIDIA NIM API (`GET /models`) and normalizes each entry's capabilities in `src/model-catalog.ts`. Models are filtered to chat-capable entries; embedding/rerank/vision-embedding models (bge, clip, embed, rerank, ...) are excluded automatically.

## Capability Normalization

For each model the catalog derives:

| Field | Source |
|-------|--------|
| `id` | API model id (e.g. `meta/llama-4-maverick-17b-128e-instruct`) |
| `displayName` | `KNOWN_MODEL_OVERRIDES` friendly name → API name → last path segment |
| `contextWindow` | API `metadata.context_window` → override → 131,072 default |
| `maxOutputTokens` | API `metadata.max_output_tokens`/`max_tokens` → override → 65,536 default |
| `supportsTools` | API `capabilities.tool_calling` → default `true` |
| `supportsVision` | API `capabilities.vision` → default `false` |

## Known Display Name Overrides

The following models get friendly display names (others fall back to their API name):

| Model ID | Display Name |
|----------|--------------|
| `meta/llama-4-maverick-17b-128e-instruct` | Llama 4 Maverick 17B 128E Instruct |
| `meta/llama-4-scout-17b-16e-instruct` | Llama 4 Scout 17B 16E Instruct |
| `nvidia/nemotron-4-340b-instruct` | Nemotron 4 340B Instruct |
| `nvidia/llama-3.1-nemotron-70b-instruct` | Llama 3.1 Nemotron 70B Instruct |
| `nvidia/llama-3.1-nemotron-ultra-253b-v1` | Llama 3.1 Nemotron Ultra 253B |
| `mistralai/mistral-large` / `mistralai/mistral-large-2407` | Mistral Large (2407) |
| `mistralai/mixtral-8x22b-instruct-v0.1` | Mixtral 8x22B Instruct |
| `qwen/qwen2.5-72b-instruct` / `qwen/qwen2.5-coder-32b-instruct` | Qwen 2.5 (Coder) 72B/32B Instruct |
| `microsoft/phi-3.5-mini-instruct` / `microsoft/phi-4` / `microsoft/phi-4-mini-instruct` | Phi 3.5 Mini / Phi 4 / Phi 4 Mini |
| `01-ai/yi-large` | Yi Large |
| `google/gemma-2-27b-it` / `gemma-2-9b-it` / `gemma-3-27b-it` / `gemma-3-12b-it` | Gemma 2/3 (27B/9B/12B) IT |
| `deepseek-ai/deepseek-r1` / `deepseek-v3` / `deepseek-v3-0324` | DeepSeek R1 / V3 / V3 0324 |
| `qwen/qwq-32b-preview` | QwQ 32B Preview |
| `anthropic/claude-3-5-sonnet` / `claude-3-5-haiku` / `claude-3-opus` | Claude 3.5 Sonnet / 3.5 Haiku / 3 Opus |

## Model Family Behavior (Adapters)

`src/adapters/index.ts` applies per-family defaults at request time:

| Family | Default Temp | Tool Temp | Notes |
|--------|-------------|-----------|-------|
| DeepSeek | 0 | 0 | Strong tool-use grounding; DSML text-embedded tool call support |
| Kimi | 0.2 | 0.1 | `reasoning_content: " "` workaround applied to assistant history |
| GLM | 0.1 | 0.05 | Strict JSON arguments guidance |
| Llama | 0.2 | 0.1 | |
| Nemotron | 0.2 | 0.1 | |
| Claude | 0.3 | 0.2 | |
| GPT | 0.3 | 0.2 | |
| Mistral / Mixtral | 0.3 | 0.2 | |
| Qwen | 0.1 | 0.05 | |
| Phi | 0.3 | 0.2 | |
| Yi | 0.3 | 0.2 | |
| Gemma | 0.3 | 0.15 | |
| Default | 0.7 | 0.3 | |

## Reasoning Models

Models that emit `reasoning_content` (e.g. `deepseek-ai/deepseek-r1`, `qwen/qwq-32b-preview`) are matched by `THINKING_MODELS` in `src/constants.ts` and get:

- A **minimum output budget floor of 16K tokens** so internal reasoning cannot exhaust the budget before a visible response is produced.
- Doubled `max_tokens` on retries (unlike non-thinking models, which cap at the model max output).
- Retry visibility tracking: a response consisting only of reasoning is retried silently.

## Model Quirks and Workarounds

| Quirk | Workaround |
|-------|------------|
| DeepSeek R1 emits `<think>...</think>` blocks in visible text | `filterThinkTagsFromChunk` strips them incrementally across chunk boundaries |
| Some models announce an action ("テストを実行します。") without emitting the tool call | `announcement.ts` detects JA/EN/ZH announcements; the stream retries with a nudge |
| Reasoning models burn the output budget on internal thinking, yielding no visible text | `reasoning-only` silent retry with doubled `max_tokens` (16K floor) |
| Responses truncated at the output budget (`finish_reason: "length"`) | `truncated` silent retry with doubled budget; a warning is shown when retries are exhausted |
| Non-vision models receive images | Vision-capable fallback model switch (silent) or background OCR via `nvidia_nim_analyze_image` |
| Kimi assistant history without `reasoning_content` | `applyMessagesWorkaround` injects `reasoning_content: " "` |

## Vision Fallback

When a chat message contains images and the selected model does not support vision:

1. If a vision-capable model exists in the catalog, the request is silently routed to it (debug log only — no chat history pollution).
2. Otherwise, images are analyzed in the background via the `nvidia_nim_analyze_image` tool using a cached vision model, and the descriptions are attached to the user message.

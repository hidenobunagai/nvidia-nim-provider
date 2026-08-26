# Model Reference

At runtime the extension fetches the available models from the NVIDIA NIM API (`GET /models`) and normalizes each entry's capabilities in `src/model-catalog.ts`. Models are filtered to chat-capable entries; embedding/rerank/vision-embedding models (bge, clip, embed, rerank, ...), guard/safety models (nemoguard, llama-guard, ...), base/completion models (codegemma, codellama, starcoder, llama2, ...), translation models (riva-translate) and calibration utilities are excluded automatically.

> **Note:** As of 2026-08 the NVIDIA `/models` endpoint returns no capability or
> metadata fields at all (chat/vision/tool_calling/context_window are all
> absent). The catalog therefore relies on the static `KNOWN_MODEL_OVERRIDES`
> table for display names, context windows and vision flags of known models,
> and applies conservative defaults to everything else. This is why the
> override table below is intentionally large.

## Capability Normalization

For each model the catalog derives:

| Field | Source |
|-------|--------|
| `id` | API model id (e.g. `deepseek-ai/deepseek-v4-flash-0731`) |
| `displayName` | `KNOWN_MODEL_OVERRIDES` friendly name → API name → last path segment |
| `contextWindow` | API `metadata.context_window` → override → 131,072 default |
| `maxOutputTokens` | API `metadata.max_output_tokens`/`max_tokens` → override → 65,536 default |
| `supportsTools` | API `capabilities.tool_calling` → override → default `true` |
| `supportsVision` | API `capabilities.vision` → override → default `false` |

Known non-tool VLMs (Fuyu 8B, DePlot, Kosmos 2) are explicitly marked
`supportsTools: false` so Agent mode does not offer them.

## Known Display Name Overrides

The following models get friendly display names (others fall back to their API
name or the last path segment). Context window and vision flags are applied
when the API omits metadata:

| Model ID | Display Name | Notes |
|----------|--------------|-------|
| `deepseek-ai/deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 | 1M context |
| `moonshotai/kimi-k2.6` | Kimi K2.6 | 256K context |
| `moonshotai/kimi-k3` | Kimi K3 | 1M context, vision, reasoning |
| `nvidia/cosmos-reason2-8b` | Cosmos Reason2 8B | 256K context, vision, reasoning |
| `meta/llama-3.2-1b-instruct` / `llama-3.2-3b-instruct` | Llama 3.2 1B / 3B Instruct | 128K context |
| `z-ai/glm-5.2` | GLM 5.2 | |
| `openai/gpt-oss-120b` / `openai/gpt-oss-20b` | GPT-OSS 120B / 20B | |
| `minimaxai/minimax-m3` | MiniMax M3 | 1M context |
| `meta/muse-glimmer-30b` | Muse Glimmer 30B | |
| `google/gemma-4-31b-it` / `gemma-3-4b-it` | Gemma 4 31B IT / Gemma 3 4B IT | |
| `meta/llama-3.3-70b-instruct` / `llama-3.1-70b-instruct` / `llama-3.1-8b-instruct` | Llama 3.3/3.1 Instruct | |
| `meta/llama-3.2-11b-vision-instruct` / `llama-3.2-90b-vision-instruct` | Llama 3.2 Vision Instruct | vision |
| `nvidia/nemotron-3-nano-30b-a3b` / `nemotron-3-super-120b-a12b` / `nemotron-3-ultra-550b-a55b` | Nemotron 3 Nano/Super/Ultra | |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | Nemotron 3 Nano Omni 30B A3B Reasoning | vision |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | Nemotron 3.5 Lightning 30B A3B | |
| `nvidia/llama-3.3-nemotron-super-49b-v1` / `-v1.5` | Llama 3.3 Nemotron Super 49B V1 / V1.5 | reasoning |
| `nvidia/llama-3.1-nemotron-51b-instruct` / `llama-3.1-nemotron-70b-instruct` | Llama 3.1 Nemotron 51B / 70B Instruct | |
| `nvidia/llama-3.1-nemotron-nano-8b-v1` / `llama-3.1-nemotron-nano-vl-8b-v1` | Nemotron Nano 8B / Nano VL 8B | VL = vision |
| `nvidia/nemotron-nano-12b-v2-vl` | Nemotron Nano 12B V2 VL | vision |
| `nvidia/nvidia-nemotron-nano-9b-v2` / `nemotron-nano-3-30b-a3b` / `nemotron-mini-4b-instruct` | NVIDIA Nemotron Nano / Mini family | |
| `nvidia/vila` / `nvidia/neva-22b` / `microsoft/phi-3-vision-128k-instruct` | VILA / NeVA 22B / Phi 3 Vision | vision |
| `nvidia/llama3-chatqa-1.5-70b` | Llama3 ChatQA 1.5 70B | 8K context |
| `writer/palmyra-fin-70b-32k` / `palmyra-med-70b` / `palmyra-med-70b-32k` | Palmyra Fin/Med 70B | 32K / 8K context |
| `adept/fuyu-8b` / `google/deplot` / `microsoft/kosmos-2` | Fuyu 8B / DePlot / Kosmos 2 | vision, non-tool |
| `mistralai/mistral-large-2-instruct` / `mistral-nemotron` / `mistral-nemo-12b-instruct` | Mistral Large 2 / Mistral Nemotron / Mistral NeMo | |
| `mistralai/mixtral-8x22b-v0.1` / `codestral-22b-instruct-v0.1` | Mixtral 8x22B / Codestral 22B | |
| `ai21labs/jamba-1.5-large-instruct` | Jamba 1.5 Large Instruct | 256K context |
| `ibm/granite-3.0-*` / `granite-*-code-instruct` | Granite 3.0 / Granite Code | |
| `databricks/dbrx-instruct` | DBRX Instruct | |
| `stepfun-ai/step-3.7-flash` / `thinkingmachines/inkling` / `poolside/laguna-xs-2.1` | Step 3.7 Flash / Inkling / Laguna XS 2.1 | |
| `meta/llama-4-maverick-17b-128e-instruct` / `meta/llama-4-scout-17b-16e-instruct` | Llama 4 Maverick / Scout | retained for older accounts |
| `deepseek-ai/deepseek-r1` / `deepseek-v3` / `deepseek-v3-0324` | DeepSeek R1 / V3 / V3 0324 | retained for older accounts |
| `qwen/qwen2.5-72b-instruct` / `qwen2.5-coder-32b-instruct` / `qwen/qwq-32b-preview` | Qwen 2.5 (Coder) / QwQ | retained for older accounts |
| `anthropic/claude-3-5-sonnet` / `claude-3-5-haiku` / `claude-3-opus` | Claude 3.5 / 3 Opus | retained for older accounts |
| `microsoft/phi-4` / `phi-4-mini-instruct` / `phi-3.5-mini-instruct` / `phi-3.5-moe-instruct` | Phi 4 / Phi 3.5 family | |
| `nvidia/nemotron-4-340b-instruct` / `nvidia/llama-3.1-nemotron-ultra-253b-v1` | Nemotron 4 / Nemotron Ultra | |

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
| Mistral / Mixtral / Codestral | 0.3 | 0.2 | |
| Qwen | 0.1 | 0.05 | |
| MiniMax | 0.6 | 0.4 | |
| Phi | 0.3 | 0.2 | |
| Yi | 0.3 | 0.2 | |
| Gemma | 0.3 | 0.15 | |
| Default | 0.7 | 0.3 | |

## Reasoning Models

Models that emit `reasoning_content` are matched by `THINKING_MODELS` in
`src/constants.ts` and get:

- A **minimum output budget floor of 16K tokens** so internal reasoning cannot exhaust the budget before a visible response is produced.
- Doubled `max_tokens` on retries (unlike non-thinking models, which cap at the model max output).
- Retry visibility tracking: a response consisting only of reasoning is retried silently.

Currently recognized reasoning families:

| Family | Model ID patterns |
|--------|-------------------|
| DeepSeek R1 | `deepseek-ai/deepseek-r1` |
| DeepSeek V4 | `deepseek-ai/deepseek-v4-*` (e.g. `deepseek-v4-flash-0731`) |
| Kimi K2 / K3 | `moonshotai/kimi-k\d*` (K2, K2.6, K3) |
| Cosmos Reason | `nvidia/cosmos-reason*` |
| GLM 5.x | `z-ai/glm-5*` |
| GPT-OSS | `openai/gpt-oss-*` |
| MiniMax M3 | `minimaxai/minimax-m3` |
| Nemotron 3 | `nvidia/nemotron-3-*` |
| Nemotron Super | `nvidia/llama-3.3-nemotron-super-49b-*` |
| QwQ | `qwen/qwq-32b-preview` |

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

1. If a vision-capable model exists in the catalog, the request is silently routed to it (debug log only — no chat history pollution). `findPreferredVisionModel` picks the best known VLM (Llama 3.2 Vision → Nemotron Nano VL → Nemotron 3 Nano Omni → Phi 3 Vision → VILA/NeVA) instead of whatever the API lists first.
2. Otherwise, images are analyzed in the background via the `nvidia_nim_analyze_image` tool using a cached vision model, and the descriptions are attached to the user message.

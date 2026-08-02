# Architecture

## Overview

The NVIDIA NIM Provider is a VS Code extension that registers a custom `LanguageModelChatProvider` ("nvidia-nim") for Copilot Chat. It translates Copilot Chat's internal message format into OpenAI-compatible requests, routes them to the NVIDIA NIM API (`https://integrate.api.nvidia.com/v1`), and streams responses back through VS Code's language model API.

```
Copilot Chat
  └─ LanguageModelChatProvider (nvidia-nim)
       └─ OpenAI Conversion
            └─ POST /v1/chat/completions  (OpenAI-compatible)
                    │
                    ├─ Retry logic (exponential backoff + jitter)
                    ├─ SSE stream parsing (idle timeout + 1 MB buffer cap)
                    ├─ Tool call detection & repair
                    ├─ Text-embedded tool call parsing (DSML / XML / OpenAI markers)
                    └─ Token counting
```

## Module Map

| Module | Responsibility |
|--------|---------------|
| `extension.ts` | Entry point. Registers the provider, MCP client, tools, and debug commands. |
| `provider.ts` | `NvidiaNimChatModelProvider` implements `LanguageModelChatProvider`. Orchestrates model listing, API key management, message conversion, and streaming. |
| `model-catalog.ts` | Normalizes the model list fetched from the NVIDIA NIM API (`/models`) into `NormalizedNvidiaModel` entries (context window, max output, vision/tool capabilities). |
| `adapters/index.ts` | Per-model-family request profiles: default temperatures and tool system messages (DeepSeek, Kimi, GLM, Llama, ...). |
| `types.ts` | Shared request/response types for the OpenAI-compatible chat completions API. |
| `api.ts` | HTTP client with retry logic. Handles `fetch`, status codes, rate limiting (`Retry-After`), request-level timeout, and SSE streaming via `ReadableStream`. |
| `openai-conversion.ts` | Converts Copilot Chat `LanguageModelChatMessage[]` → `/chat/completions` request format, with a bounded reasoning-content LRU cache. |
| `streaming/openai.ts` | Parses OpenAI-compatible SSE streams into `LanguageModelResponsePart[]`, including retry logic. |
| `streaming/shared.ts` | `StreamState`: reasoning display, pending text flushing, tool call emission, and retry visibility tracking. |
| `message-parts.ts` | Type guards (`hasTextValue`, `isToolCallPart`, `isToolResultPart`) and extraction helpers for `LanguageModelInputPart` and legacy parts. |
| `tokenizer.ts` | Lightweight token estimator (CJK ~1 token/char, other ~2 chars/token). No WASM/tiktoken dependency. |
| `tool-parser.ts` | Parses text-embedded tool calls (OpenAI markers, XML-style blocks, DeepSeek DSML markers) from streaming model output. Includes `ToolCallScanner` for incremental parsing. |
| `announcement.ts` | Detects responses that end by announcing an action (JA/EN/ZH) without emitting the tool call, and builds the nudge message used to continue the turn. |
| `tool-repair.ts` | Deduplicates tool calls, repairs missing arguments from chat context, and coerces argument types using `inputSchema`. |
| `tools.ts` | Registers the `nvidia_nim_analyze_image` language model tool for vision requests. |
| `mcp.ts` | Image-analysis client that calls a cached NVIDIA NIM vision model for OCR fallback. |
| `guidance.ts` | Builds system-prompt guidance: provider identity, tool-use instructions, and DeepSeek-specific prompt sanitization. |
| `output-channel.ts` | Centralized debug logging via `vscode.OutputChannel`. |
| `constants.ts` | API base URL, timeout values, context window safety margins, and thinking-model sets. |
| `status-bar.ts` | Status bar item showing model count and refresh action. |

## Data Flow

### 1. Model Discovery

The provider fetches the current model list from the NVIDIA NIM API (`GET /models`), filters out non-chat models, and normalizes each entry's capabilities with `model-catalog.ts` (using known display-name overrides). Normalized models are cached in `globalState` (`nvidia-nim.models`) and refreshed on demand or via the **Refresh Models** command. Model metadata (name, context window, capabilities) is returned to Copilot Chat.

### 2. Request Lifecycle

1. **Copilot Chat** calls `provideLanguageModelChatResponse(messages, options, token)`.
2. The provider reads the API key from `SecretStorage` (`nvidia-nim.apiKey`) or from the provider group configuration.
3. If the selected model does not support vision and the chat contains images, the provider either switches to a vision-capable fallback model (silently, debug log only) or runs background image analysis via the vision MCP client.
4. System prompt guidance is injected (`guidance.ts`):
   - Provider identity ("You are GitHub Copilot using NVIDIA NIM...")
   - Tool-use grounding instructions
   - DeepSeek-specific prompt sanitization (replaces "Claude" → "GitHub Copilot", "Anthropic" → "NVIDIA NIM")
5. Messages are converted with `openai-conversion.ts`, model-family profiles are applied (`adapters/index.ts`), and the request is sent to `POST /v1/chat/completions`.
6. The response is streamed back as SSE, parsed into `LanguageModelResponsePart[]`, and yielded to Copilot Chat.

### 3. Tool Execution

- **Native tool calls**: Assembled from `delta.tool_calls` fragments and emitted when a text/reasoning delta arrives or the stream ends (`emitPendingToolCalls`).
- **Text-embedded tool calls**: Parsed from streaming output by `tool-parser.ts` (`ToolCallScanner`). Detects `<|tool_call_begin|>` markers, XML-style `<tool_calls>` blocks, and DeepSeek DSML markers (`<｜tool▁call▁begin｜>` etc.).
- **Tool call repair**: Before re-sending a tool call, `tool-repair.ts` checks for duplicates and repairs missing/invalid arguments using `inputSchema` and chat context (file path, selection, CWD).
- **Vision tool**: The `nvidia_nim_analyze_image` language model tool is registered via `tools.ts` for models without native vision support.

### 4. Error Handling & Retry

`api.ts` implements exponential backoff with full jitter:
- Retries on `429` (rate limit), `502`, `503`, `504`
- Respects `Retry-After` headers
- Request-level timeout (120s)
- Per-read SSE idle timeout (scaled by model max output tokens) to detect silent connection drops
- 1 MB safety cap on the SSE assembly buffer

The streaming handler (`streaming/openai.ts`) additionally retries a single user-visible request up to 3 times when an attempt yields no usable output: reasoning-only output, empty responses, mid-response stops, truncation (`finish_reason: "length"`), invalid tool calls, or an **action announcement without a tool call** (`announcement.ts` detects endings like "テストを実行します。" / "I will run the tests."; the buffered announcement is replayed as an assistant message followed by a nudge so the model emits the tool call it announced). These retries are silent — no `(Retrying...)` text is written to the chat, because such text would persist in the conversation history and confuse the model on later turns.

## API Format

The NVIDIA NIM API (`https://integrate.api.nvidia.com/v1`) is OpenAI-compatible. All requests use `POST /v1/chat/completions` with standard SSE streaming (`data: {...}` lines, `[DONE]` terminator). Reasoning models (e.g. DeepSeek R1) stream `reasoning_content` deltas, which are surfaced via `LanguageModelThinkingPart` when available or formatted as a thinking block when the `nvidia-nim.showReasoning` setting is enabled.

## Key Design Decisions

- **Zero runtime dependencies**: All HTTP, streaming, and parsing logic is built on Node.js/VS Code APIs.
- **Dynamic model discovery**: The model list is fetched from the NVIDIA NIM API at runtime and cached; new models usually work without an extension update.
- **Model-family adapters**: Temperature defaults and tool-use system messages differ per model family (DeepSeek, Kimi, GLM, Llama, ...), applied via `adapters/index.ts`.
- **Lightweight tokenizer**: Token estimation counts CJK/full-width characters as ~1 token each and other characters as ~1/2 token each, instead of loading a full tokenizer (tiktoken/WASM). This sacrifices precision for zero binary dependencies and fast startup, while avoiding severe undercounts for Japanese/Chinese/Korean input.
- **Vision fallback**: Non-vision models get image support via a vision-capable fallback model or background OCR analysis.
- **Think-tag filtering**: `<think>...</think>` blocks in streamed text are stripped in real time (NVIDIA NIM models such as DeepSeek R1 may emit them).

# Contributing

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.2 (package manager & runtime)
- [VS Code](https://code.visualstudio.com/) ≥ 1.104.0
- Git

## Setup

```bash
git clone https://github.com/hidenobunagai/nvidia-nim-provider.git
cd nvidia-nim-provider
bun install --ignore-scripts
bun run compile
```

## Development Workflow

### Build

```bash
bun run compile    # TypeScript compilation (tsc)
bun run watch      # Watch mode — recompiles on file change
```

### Testing

```bash
bun run test              # Run all tests (Jest)
bun run test -- --runInBand  # Run tests serially (recommended for CI)
bun run test:coverage     # Run tests with coverage report
```

Test files live in `tests/` and mirror the `src/` structure:
- `tests/api.test.ts` — API client, retry logic, and SSE streaming
- `tests/provider.test.ts` — Provider lifecycle, model discovery, streaming, and retry paths
- `tests/announcement.test.ts` — Action-announcement detection and nudge text
- `tests/guidance.test.ts` — System prompt sanitization and guidance
- `tests/tool-repair.test.ts` — Tool argument repair and dedup
- `tests/model-catalog.test.ts` — Model normalization and capability inference
- `tests/mcp.test.ts` — Vision MCP client integration
- `tests/tools.test.ts` — Language model tool registration
- `tests/utils.test.ts` — Message conversion, tokenizer, reasoning cache
- `tests/extension.test.ts` — Extension activation/deactivation

### Linting & Formatting

```bash
bun run lint       # ESLint check
bun run lint:fix   # Auto-fix lint issues
bun run format     # Prettier formatting
```

### Running the Extension

1. Open the project in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. In the Extension Dev Host, open Copilot Chat (`Cmd/Ctrl + Alt + I`).
4. Select the **NVIDIA NIM** model from the model picker and enter your API key when prompted.

## Adding or Updating a Model Family

NVIDIA NIM models are discovered dynamically from the API, but model-family behavior is tuned in two places:

1. **`src/model-catalog.ts`** — `KNOWN_MODEL_OVERRIDES` maps model IDs to friendly display names and (optionally) capability overrides.
2. **`src/adapters/index.ts`** — each model family profile sets default temperatures and a tool-use system message via an `idPattern` regex (order matters: the first matching profile wins).

## Debugging

### Debug Logging

Toggle debug logging from the Command Palette: `NVIDIA NIM: Toggle Debug Logging`.

View logs: `NVIDIA NIM: Open Debug Log`.

Debug logs include:
- Provider lifecycle events
- API request/response metadata (no API keys)
- Tool call parsing and repair details
- Stream errors and retry events (including `captureLog` payloads for truncated / no-output responses)

### Reproducing a Truncated or No-Output Response

When a model returns no visible output or is truncated, the extension writes a **Capture** entry to the output channel containing the full `requestBody` payloads of every attempt. Replay those payloads directly against `POST https://integrate.api.nvidia.com/v1/chat/completions` with `curl` to compare plain-vs-extension behavior.

## Project Structure

```
nvidia-nim-provider/
├── src/
│   ├── extension.ts          # Entry point
│   ├── provider.ts           # LanguageModelChatProvider
│   ├── model-catalog.ts      # Model normalization + overrides
│   ├── adapters/index.ts     # Model-family request profiles
│   ├── types.ts              # Request/response types
│   ├── api.ts                # HTTP client + retry + SSE
│   ├── openai-conversion.ts  # Message conversion + reasoning cache
│   ├── streaming/
│   │   ├── openai.ts         # OpenAI SSE parser + retry
│   │   └── shared.ts         # Shared streaming state
│   ├── announcement.ts       # Action-announcement detection + nudge
│   ├── message-parts.ts      # Type guards + part extractors
│   ├── tokenizer.ts          # Token estimator
│   ├── tool-parser.ts        # Text-embedded tool call parser
│   ├── tool-repair.ts        # Tool argument repair + dedup
│   ├── tools.ts              # Language model tool registration
│   ├── mcp.ts                # Vision MCP client
│   ├── guidance.ts           # System prompt guidance
│   ├── output-channel.ts     # Debug logging
│   ├── constants.ts          # Constants + workarounds
│   ├── status-bar.ts         # Status bar item
│   └── utils.ts              # Re-export hub
├── tests/                    # Jest test files
├── docs/                     # Documentation
└── images/                   # Extension icon
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on Linux/macOS/Windows:
1. **Compile** — TypeScript `tsc`
2. **Lint** — ESLint
3. **Test** — Jest with coverage (50% global threshold)

Coverage reports are uploaded as artifacts on each CI run.

## Release

1. Update `version` in `package.json` and add a CHANGELOG entry.
2. Commit and push to `main`.
3. Create a GitHub release for the new version tag — the built VSIX is attached manually:
   ```bash
   bun run package:vsix
   ```
4. Publish to the VS Code Marketplace via `vsce publish`.

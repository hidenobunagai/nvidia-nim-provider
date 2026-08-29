# NVIDIA NIM Provider

VS Code extension that adds an NVIDIA NIM provider to Copilot Chat.

## Requirements

- VS Code 1.104.0 or later
- GitHub Copilot extension installed and active
- An NVIDIA NIM API key from [build.nvidia.com/models](https://build.nvidia.com/models)

## Installation

### From Source

1. Clone this repository.
2. Run `bun install --ignore-scripts && bun run compile`.
3. Press `F5` in VS Code to launch the Extension Development Host.

### From VSIX

1. Run `bun install --ignore-scripts && bun run package:vsix`.
2. Install the generated `.vsix` file via the Extensions view (`Install from VSIX...`).

## Setup

1. Open Copilot Chat and choose the model picker.
2. Select **Manage Models**, then add/configure **NVIDIA NIM**.
3. Paste the API key obtained from [build.nvidia.com/models](https://build.nvidia.com/models).
4. Select one of the NVIDIA NIM models returned by your account.

You can also run `NVIDIA NIM: Manage NVIDIA NIM API Key` from the Command Palette. The extension
will migrate that key into VS Code's language model provider group so the model picker can resolve
NVIDIA NIM models. The VS Code model settings flow is recommended for new setups.

## Supported Models

The extension dynamically fetches available models from `https://integrate.api.nvidia.com/v1/models`.
It does not ship a hardcoded fallback model catalog; the Copilot Chat model picker shows the models
returned by your NVIDIA NIM account (DeepSeek V4 Flash, **Kimi K3** / K2.6, **Cosmos Reason2 8B**, GLM 5.2, GPT-OSS, Nemotron 3,
Llama 3.3/3.2, Gemma 4, Muse Glimmer, Llama3 ChatQA, Palmyra, and more — 102 models live as of 2026-08-22).

Because the NVIDIA `/models` response currently omits capability metadata (context window, vision,
tool calling), the extension ships a static override table (`src/model-catalog.ts`) that fills in
display names, context windows and vision flags for known models, and applies conservative defaults
to the rest. Chat models are treated as tool-capable so they remain selectable in Copilot Chat Agent
mode; known non-tool VLMs (Fuyu, DePlot, Kosmos 2) are explicitly excluded from Agent mode, and
non-chat catalog entries (embedding, rerank, guard/safety, base/completion, translation models) are
filtered out of the picker. Non-chat model ids are re-checked whenever the catalog changes, so the
filter stays in sync with the live catalog (see `docs/models.md` for details).

Reasoning models (DeepSeek R1/V4, Kimi K3/K2.6, Cosmos Reason2, GLM 5.2, GPT-OSS, MiniMax M3, Nemotron 3, Nemotron
Super, QwQ) get a minimum output budget floor and silent retries so long thinking steps cannot
truncate the visible response.

## Usage

1. Open Copilot Chat (`Cmd/Ctrl + Alt + I`).
2. Select **NVIDIA NIM** from the provider selector.
3. Choose one of the dynamically discovered NVIDIA NIM models and start chatting.

## Development

```bash
bun install --ignore-scripts
bun run compile
bun run lint
bun run test -- --runInBand
bun run test:coverage
```

Press `F5` in VS Code to launch the Extension Development Host.

### Available Scripts

- `bun run compile` – TypeScript コンパイル
- `bun run watch` – ファイル変更監視付きコンパイル
- `bun run test` – テスト実行
- `bun run test:coverage` – カバレッジ付きテスト実行
- `bun run lint` – ESLint チェック
- `bun run lint:fix` – ESLint 自動修正
- `bun run format` – Prettier フォーマット
- `bun run package:vsix` – VSIX パッケージ作成

## Documentation

- [Interactive Architecture Diagram](docs/architecture.html) — explorable runtime map with source references, guided views, and theme switching
- [Architecture](docs/architecture.md) — module map, data flow, retry and error handling
- [Model Reference](docs/models.md) — model discovery, capability normalization, family adapters, and known quirks/workarounds
- [Contributing](docs/contributing.md) — setup, testing, debugging, release steps

## Marketplace Packaging

```bash
bun run package:vsix
```

The command above produces a `.vsix` that can be uploaded in the VS Code Marketplace publisher portal.

## Privacy

- Your API key is stored securely through VS Code's language model provider configuration and, for
  legacy command-palette setup, VS Code SecretStorage.
- Chat completions and model discovery requests are sent to `https://integrate.api.nvidia.com/v1`.

import type { NvidiaModelSummary } from "./types";

export interface NormalizedNvidiaModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

const DEFAULT_CONTEXT_WINDOW = 131072;
const DEFAULT_MAX_OUTPUT_TOKENS = 65536;
const NON_CHAT_MODEL_ID_PATTERNS = [
  /(^|[/_-])bge([-_/]|$)/i,
  /(^|[/_-])(clip|detector|embed|embedcode|embedqa|embedding|gliner|parse|rerank|retriever|reward)([-_/]|$)/i,
];

const KNOWN_MODEL_OVERRIDES: Record<string, Partial<NormalizedNvidiaModel>> = {
  "meta/llama-3.1-8b-instruct": {
    contextWindow: 128000,
  },
  "meta/llama-3.1-70b-instruct": {
    contextWindow: 128000,
  },
  "deepseek-ai/deepseek-v4-flash": {
    contextWindow: 1000000,
  },
  "deepseek-ai/deepseek-v4-pro": {
    contextWindow: 1000000,
  },
  "meta/llama-4-maverick-17b-128e-instruct": {
    displayName: "Llama 4 Maverick 17B 128E Instruct",
  },
  "meta/llama-4-scout-17b-16e-instruct": {
    displayName: "Llama 4 Scout 17B 16E Instruct",
  },
  "nvidia/nemotron-4-340b-instruct": {
    displayName: "Nemotron 4 340B Instruct",
  },
  "nvidia/llama-3.1-nemotron-70b-instruct": {
    displayName: "Llama 3.1 Nemotron 70B Instruct",
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": {
    displayName: "Llama 3.1 Nemotron Ultra 253B",
  },
  "mistralai/mistral-large": {
    displayName: "Mistral Large",
  },
  "mistralai/mistral-large-2407": {
    displayName: "Mistral Large 2407",
  },
  "mistralai/mixtral-8x22b-instruct-v0.1": {
    displayName: "Mixtral 8x22B Instruct",
  },
  "qwen/qwen2.5-72b-instruct": {
    displayName: "Qwen 2.5 72B Instruct",
  },
  "qwen/qwen2.5-coder-32b-instruct": {
    displayName: "Qwen 2.5 Coder 32B Instruct",
  },
  "microsoft/phi-3.5-mini-instruct": {
    displayName: "Phi 3.5 Mini Instruct",
  },
  "microsoft/phi-4-mini-instruct": {
    displayName: "Phi 4 Mini Instruct",
    contextWindow: 128000,
  },
  "openai/gpt-oss-120b": {
    displayName: "GPT OSS 120B",
    contextWindow: 128000,
  },
  "moonshotai/kimi-k2.5": {
    displayName: "Kimi K2.5",
    contextWindow: 262144,
  },
  "moonshotai/kimi-k2.6": {
    displayName: "Kimi K2.6",
    contextWindow: 262144,
  },
  "01-ai/yi-large": {
    displayName: "Yi Large",
  },
  "google/gemma-2-27b-it": {
    displayName: "Gemma 2 27B IT",
  },
  "google/gemma-2-9b-it": {
    displayName: "Gemma 2 9B IT",
  },
  "google/gemma-3-27b-it": {
    displayName: "Gemma 3 27B IT",
  },
  "google/gemma-3-12b-it": {
    displayName: "Gemma 3 12B IT",
  },
  "deepseek-ai/deepseek-r1": {
    displayName: "DeepSeek R1",
  },
  "deepseek-ai/deepseek-v3": {
    displayName: "DeepSeek V3",
  },
  "deepseek-ai/deepseek-v3-0324": {
    displayName: "DeepSeek V3 0324",
  },
  "qwen/qwq-32b-preview": {
    displayName: "QwQ 32B Preview",
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1:awq-moe": {
    displayName: "Llama 3.1 Nemotron Ultra 253B (AWQ MoE)",
  },
  "anthropic/claude-3-5-sonnet": {
    displayName: "Claude 3.5 Sonnet",
  },
  "anthropic/claude-3-5-haiku": {
    displayName: "Claude 3.5 Haiku",
  },
  "anthropic/claude-3-opus": {
    displayName: "Claude 3 Opus",
  },
  "microsoft/phi-4": {
    displayName: "Phi 4",
  },
  "z-ai/glm4.7": {
    displayName: "GLM-4.7",
    contextWindow: 204800,
  },
  "z-ai/glm5.1": {
    displayName: "GLM-5.1",
    contextWindow: 204800,
  },
};

export function rehydrateNormalizedNvidiaModel(model: NormalizedNvidiaModel): NormalizedNvidiaModel {
  const override = KNOWN_MODEL_OVERRIDES[model.id];
  if (!override) {
    return model;
  }

  return {
    ...model,
    displayName: override.displayName ?? model.displayName,
    contextWindow:
      override.contextWindow !== undefined && model.contextWindow === DEFAULT_CONTEXT_WINDOW
        ? override.contextWindow
        : model.contextWindow,
    maxOutputTokens:
      override.maxOutputTokens !== undefined && model.maxOutputTokens === DEFAULT_MAX_OUTPUT_TOKENS
        ? override.maxOutputTokens
        : model.maxOutputTokens,
    supportsTools: override.supportsTools ?? model.supportsTools,
    supportsVision: override.supportsVision ?? model.supportsVision,
  };
}

export function normalizeNvidiaModels(models: NvidiaModelSummary[]): NormalizedNvidiaModel[] {
  const seenIds = new Set<string>();
  const normalizedModels: NormalizedNvidiaModel[] = [];

  for (const model of models) {
    if (seenIds.has(model.id) || !isChatModel(model)) {
      continue;
    }
    seenIds.add(model.id);
    normalizedModels.push(normalizeNvidiaModel(model));
  }

  return normalizedModels;
}

export function isNormalizedNvidiaModel(value: unknown): value is NormalizedNvidiaModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<NormalizedNvidiaModel>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.contextWindow === "number" &&
    typeof candidate.maxOutputTokens === "number" &&
    typeof candidate.supportsTools === "boolean" &&
    typeof candidate.supportsVision === "boolean"
  );
}

function normalizeNvidiaModel(model: NvidiaModelSummary): NormalizedNvidiaModel {
  const override = KNOWN_MODEL_OVERRIDES[model.id];

  return {
    id: model.id,
    displayName: model.name ?? override?.displayName ?? deriveDisplayName(model.id),
    contextWindow:
      getPositiveNumber(model.metadata?.context_window) ??
      getPositiveNumber(override?.contextWindow) ??
      DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens:
      getPositiveNumber(model.metadata?.max_output_tokens) ??
      getPositiveNumber(model.metadata?.max_tokens) ??
      getPositiveNumber(override?.maxOutputTokens) ??
      DEFAULT_MAX_OUTPUT_TOKENS,
    supportsTools: model.capabilities?.tool_calling ?? override?.supportsTools ?? true,
    supportsVision: model.capabilities?.vision ?? override?.supportsVision ?? false,
  };
}

function isChatModel(model: NvidiaModelSummary): boolean {
  if (model.capabilities?.chat === true) {
    return true;
  }

  if (model.capabilities?.chat === false) {
    return false;
  }

  return !isClearlyNonChatModelId(model.id);
}

function isClearlyNonChatModelId(modelId: string): boolean {
  return NON_CHAT_MODEL_ID_PATTERNS.some((pattern) => pattern.test(modelId));
}

function deriveDisplayName(modelId: string): string {
  const lastSegment = modelId.split("/").at(-1);
  return lastSegment && lastSegment.length > 0 ? lastSegment : modelId;
}

function getPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

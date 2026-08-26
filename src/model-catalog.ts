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
export const DEFAULT_MAX_OUTPUT_TOKENS = 65536;
const NON_CHAT_MODEL_ID_PATTERNS = [
  // Embedding / rerank / retrieval / parsing / reward / detector families
  /(^|[/_-])bge([-_/]|$)/i,
  /(^|[/_-])(clip|detector|embed|embedcode|embedqa|embedding|gliner|parse|rerank|retriever|reward)([-_/]|$)/i,
  // nv-prefixed utility models (e.g. nvclip)
  /(^|[/_-])nv(clip|embed|embedcode|embedqa|retriever|rerank)([-_/]|$)/i,
  // Safety / moderation / guard models (not chat models)
  /(^|[/_-])(guard|safety|nemoguard)([-_/]|$)/i,
  // Base / code-completion models without a chat template
  /(^|[/_-])(codegemma|codellama|starcoder\d*)([-_/]|$)/i,
  /(^|[/_-])llama2([-_/]|$)/i,
  /(^|[/_-])(gemma-2b|recurrentgemma|diffusiongemma)([-_/]|$)/i,
  // Speech translation and physics/calibration utilities
  /(^|[/_-])(riva|translate|calibration)([-_/]|$)/i,
];

const KNOWN_MODEL_OVERRIDES: Record<string, Partial<NormalizedNvidiaModel>> = {
  "adept/fuyu-8b": {
    displayName: "Fuyu 8B",
    supportsVision: true,
    supportsTools: false,
  },
  "ai21labs/jamba-1.5-large-instruct": {
    displayName: "Jamba 1.5 Large Instruct",
    contextWindow: 262144,
  },
  "aisingapore/sea-lion-7b-instruct": {
    displayName: "SEA-LION 7B Instruct",
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
  "databricks/dbrx-instruct": {
    displayName: "DBRX Instruct",
    contextWindow: 32768,
  },
  "deepseek-ai/deepseek-coder-6.7b-instruct": {
    displayName: "DeepSeek Coder 6.7B Instruct",
    contextWindow: 16384,
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
  "deepseek-ai/deepseek-v4-flash-0731": {
    displayName: "DeepSeek V4 Flash 0731",
    contextWindow: 1000000,
    maxOutputTokens: 384000,
  },
  "google/deplot": {
    displayName: "DePlot",
    supportsVision: true,
    supportsTools: false,
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
  "google/gemma-3-4b-it": {
    displayName: "Gemma 3 4B IT",
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsVision: true,
  },
  "google/gemma-4-31b-it": {
    displayName: "Gemma 4 31B IT",
    contextWindow: 131072,
  },
  "ibm/granite-3.0-3b-a800m-instruct": {
    displayName: "Granite 3.0 3B A800M Instruct",
    contextWindow: 131072,
  },
  "ibm/granite-3.0-8b-instruct": {
    displayName: "Granite 3.0 8B Instruct",
    contextWindow: 131072,
  },
  "ibm/granite-34b-code-instruct": {
    displayName: "Granite 34B Code Instruct",
    contextWindow: 131072,
  },
  "ibm/granite-8b-code-instruct": {
    displayName: "Granite 8B Code Instruct",
    contextWindow: 131072,
  },
  "meta/llama-3.1-70b-instruct": {
    displayName: "Llama 3.1 70B Instruct",
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  "meta/llama-3.1-8b-instruct": {
    displayName: "Llama 3.1 8B Instruct",
    contextWindow: 131072,
    maxOutputTokens: 4096,
  },
  "meta/llama-3.2-1b-instruct": {
    displayName: "Llama 3.2 1B Instruct",
    contextWindow: 131072,
  },
  "meta/llama-3.2-3b-instruct": {
    displayName: "Llama 3.2 3B Instruct",
    contextWindow: 131072,
  },
  "meta/llama-3.2-11b-vision-instruct": {
    displayName: "Llama 3.2 11B Vision Instruct",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
  },
  "meta/llama-3.2-90b-vision-instruct": {
    displayName: "Llama 3.2 90B Vision Instruct",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
  },
  "meta/llama-3.3-70b-instruct": {
    displayName: "Llama 3.3 70B Instruct",
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  "meta/llama-4-maverick-17b-128e-instruct": {
    displayName: "Llama 4 Maverick 17B 128E Instruct",
  },
  "meta/llama-4-scout-17b-16e-instruct": {
    displayName: "Llama 4 Scout 17B 16E Instruct",
  },
  "meta/muse-glimmer-30b": {
    displayName: "Muse Glimmer 30B",
    contextWindow: 131072,
    maxOutputTokens: 131072,
    supportsVision: true,
  },
  "microsoft/kosmos-2": {
    displayName: "Kosmos 2",
    supportsVision: true,
    supportsTools: false,
  },
  "microsoft/phi-3-vision-128k-instruct": {
    displayName: "Phi 3 Vision 128K Instruct",
    contextWindow: 131072,
    supportsVision: true,
  },
  "microsoft/phi-3.5-mini-instruct": {
    displayName: "Phi 3.5 Mini Instruct",
  },
  "microsoft/phi-3.5-moe-instruct": {
    displayName: "Phi 3.5 MoE Instruct",
    contextWindow: 131072,
  },
  "microsoft/phi-4": {
    displayName: "Phi 4",
  },
  "microsoft/phi-4-mini-instruct": {
    displayName: "Phi 4 Mini Instruct",
  },
  "minimaxai/minimax-m3": {
    displayName: "MiniMax M3",
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    supportsVision: true,
  },
  "mistralai/codestral-22b-instruct-v0.1": {
    displayName: "Codestral 22B Instruct",
    contextWindow: 32768,
  },
  "mistralai/mistral-7b-instruct-v0.3": {
    displayName: "Mistral 7B Instruct",
    contextWindow: 65536,
  },
  "mistralai/mistral-large": {
    displayName: "Mistral Large",
  },
  "mistralai/mistral-large-2407": {
    displayName: "Mistral Large 2407",
  },
  "mistralai/mistral-large-2-instruct": {
    displayName: "Mistral Large 2 Instruct",
    contextWindow: 131072,
  },
  "mistralai/mistral-nemotron": {
    displayName: "Mistral Nemotron",
    contextWindow: 131072,
  },
  "mistralai/mixtral-8x22b-instruct-v0.1": {
    displayName: "Mixtral 8x22B Instruct",
  },
  "mistralai/mixtral-8x22b-v0.1": {
    displayName: "Mixtral 8x22B Instruct",
    contextWindow: 65536,
  },
  "moonshotai/kimi-k2.6": {
    displayName: "Kimi K2.6",
    contextWindow: 262144,
    maxOutputTokens: 262144,
    supportsVision: true,
  },
  "moonshotai/kimi-k3": {
    displayName: "Kimi K3",
    contextWindow: 1048576,
    maxOutputTokens: 131072,
    supportsVision: true,
  },
  "nv-mistralai/mistral-nemo-12b-instruct": {
    displayName: "Mistral NeMo 12B Instruct",
    contextWindow: 131072,
  },
  "nvidia/llama-3.1-nemotron-51b-instruct": {
    displayName: "Llama 3.1 Nemotron 51B Instruct",
    contextWindow: 131072,
  },
  "nvidia/llama-3.1-nemotron-70b-instruct": {
    displayName: "Llama 3.1 Nemotron 70B Instruct",
    contextWindow: 128000,
    maxOutputTokens: 8192,
  },
  "nvidia/llama-3.1-nemotron-nano-8b-v1": {
    displayName: "Llama 3.1 Nemotron Nano 8B V1",
    contextWindow: 131072,
    maxOutputTokens: 16384,
  },
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1": {
    displayName: "Llama 3.1 Nemotron Nano VL 8B V1",
    contextWindow: 32768,
    maxOutputTokens: 16384,
    supportsVision: true,
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": {
    displayName: "Llama 3.1 Nemotron Ultra 253B",
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1:awq-moe": {
    displayName: "Llama 3.1 Nemotron Ultra 253B (AWQ MoE)",
  },
  "nvidia/llama-3.3-nemotron-super-49b-v1": {
    displayName: "Llama 3.3 Nemotron Super 49B V1",
    contextWindow: 131072,
  },
  "nvidia/llama-3.3-nemotron-super-49b-v1.5": {
    displayName: "Llama 3.3 Nemotron Super 49B V1.5",
    contextWindow: 131072,
  },
  "nvidia/cosmos-reason2-8b": {
    displayName: "Cosmos Reason2 8B",
    contextWindow: 262144,
    maxOutputTokens: 16384,
    supportsVision: true,
  },
  "nvidia/llama3-chatqa-1.5-70b": {
    displayName: "Llama3 ChatQA 1.5 70B",
    contextWindow: 8192,
  },
  "nvidia/mistral-nemo-minitron-8b-8k-instruct": {
    displayName: "Mistral NeMo Minitron 8B 8K Instruct",
    contextWindow: 8192,
  },
  "nvidia/nemotron-3-nano-30b-a3b": {
    displayName: "Nemotron 3 Nano 30B A3B",
    contextWindow: 131072,
    maxOutputTokens: 131072,
  },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": {
    displayName: "Nemotron 3 Nano Omni 30B A3B Reasoning",
    contextWindow: 256000,
    supportsVision: true,
  },
  "nvidia/nemotron-3-super-120b-a12b": {
    displayName: "Nemotron 3 Super 120B A12B",
    contextWindow: 262144,
    maxOutputTokens: 262144,
  },
  "nvidia/nemotron-3-ultra-550b-a55b": {
    displayName: "Nemotron 3 Ultra 550B A55B",
    contextWindow: 1000000,
  },
  "nvidia/nemotron-3.5-lightning-30b-a3b": {
    displayName: "Nemotron 3.5 Lightning 30B A3B",
    contextWindow: 262144,
    maxOutputTokens: 262144,
  },
  "nvidia/nemotron-4-340b-instruct": {
    displayName: "Nemotron 4 340B Instruct",
  },
  "nvidia/nemotron-mini-4b-instruct": {
    displayName: "Nemotron Mini 4B Instruct",
  },
  "nvidia/nemotron-nano-12b-v2-vl": {
    displayName: "Nemotron Nano 12B V2 VL",
    contextWindow: 128000,
    maxOutputTokens: 128000,
    supportsVision: true,
  },
  "nvidia/nemotron-nano-3-30b-a3b": {
    displayName: "Nemotron Nano 3 30B A3B",
    contextWindow: 131072,
  },
  "nvidia/neva-22b": {
    displayName: "NeVA 22B",
    supportsVision: true,
  },
  "nvidia/nvidia-nemotron-nano-9b-v2": {
    displayName: "NVIDIA Nemotron Nano 9B V2",
    contextWindow: 131072,
    maxOutputTokens: 131072,
  },
  "nvidia/vila": {
    displayName: "VILA",
    supportsVision: true,
  },
  "01-ai/yi-large": {
    displayName: "Yi Large",
  },
  "openai/gpt-oss-20b": {
    displayName: "GPT-OSS 20B",
    contextWindow: 131072,
    maxOutputTokens: 32768,
  },
  "openai/gpt-oss-120b": {
    displayName: "GPT-OSS 120B",
    contextWindow: 128000,
  },
  "poolside/laguna-xs-2.1": {
    displayName: "Laguna XS 2.1",
    contextWindow: 262144,
    maxOutputTokens: 16384,
  },
  "qwen/qwen2.5-72b-instruct": {
    displayName: "Qwen 2.5 72B Instruct",
  },
  "qwen/qwen2.5-coder-32b-instruct": {
    displayName: "Qwen 2.5 Coder 32B Instruct",
  },
  "qwen/qwq-32b-preview": {
    displayName: "QwQ 32B Preview",
  },
  "stepfun-ai/step-3.7-flash": {
    displayName: "Step 3.7 Flash",
    contextWindow: 256000,
    maxOutputTokens: 16384,
    supportsVision: true,
  },
  "thinkingmachines/inkling": {
    displayName: "Inkling",
    contextWindow: 1048576,
    maxOutputTokens: 16384,
    supportsVision: true,
  },
  "writer/palmyra-creative-122b": {
    displayName: "Palmyra Creative 122B",
  },
  "writer/palmyra-fin-70b-32k": {
    displayName: "Palmyra Fin 70B 32K",
    contextWindow: 32768,
  },
  "writer/palmyra-med-70b": {
    displayName: "Palmyra Med 70B",
    contextWindow: 8192,
  },
  "writer/palmyra-med-70b-32k": {
    displayName: "Palmyra Med 70B 32K",
    contextWindow: 32768,
  },
  "z-ai/glm-5.2": {
    displayName: "GLM 5.2",
    contextWindow: 131072,
  },
  "zyphra/zamba2-7b-instruct": {
    displayName: "Zamba2 7B Instruct",
  },
};

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

/**
 * Preferred vision-capable models for the silent image fallback, best first.
 * The NVIDIA `/models` endpoint currently omits capability metadata, so the
 * catalog cannot tell which models actually accept image input; this list
 * keeps the fallback on modern, capable VLMs instead of whatever the API
 * happens to list first (e.g. a small old VLM).
 */
const VISION_FALLBACK_PREFERENCE_PATTERNS = [
  /(^|[\/_-])llama-3\.2-11b-vision([\/_-]|$)/i,
  /(^|[\/_-])llama-3\.2-90b-vision([\/_-]|$)/i,
  /(^|[\/_-])nemotron-nano-12b-v2-vl([\/_-]|$)/i,
  /(^|[\/_-])nemotron-3-nano-omni([\/_-]|$)/i,
  /(^|[\/_-])llama-3\.1-nemotron-nano-vl([\/_-]|$)/i,
  /(^|[\/_-])phi-3-vision([\/_-]|$)/i,
  /(^|[\/_-])vila([\/_-]|$)/i,
  /(^|[\/_-])neva([\/_-]|$)/i,
] as const;

/**
 * Pick the preferred vision model from a normalized catalog.  Falls back to
 * the first vision-capable model when no preferred model is present.
 */
export function findPreferredVisionModel(
  models: readonly NormalizedNvidiaModel[],
): NormalizedNvidiaModel | undefined {
  for (const pattern of VISION_FALLBACK_PREFERENCE_PATTERNS) {
    const match = models.find((model) => model.supportsVision && pattern.test(model.id));
    if (match) {
      return match;
    }
  }
  return models.find((model) => model.supportsVision);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json") as { version: string };

export const PROVIDER_VENDOR = "nvidia-nim";
export const PROVIDER_DISPLAY_NAME = "NVIDIA NIM";
export const SECRET_STORAGE_KEY = "nvidia-nim.apiKey";
export const RAW_MODELS_STATE_KEY = "nvidia-nim.rawModels";
export const MODELS_STATE_KEY = "nvidia-nim.models";
export const MODELS_CACHE_VERSION_STATE_KEY = "nvidia-nim.modelsCacheVersion";
export const MODELS_CACHE_VERSION = 6;
export const MIGRATION_DONE_KEY = "nvidia-nim.legacyMigrationDone";
export const DEBUG_STATE_KEY = "nvidia-nim.debug";
export const DEBUG_ENV_VAR = "NVIDIA_NIM_DEBUG";
export const MANAGE_COMMAND_ID = "nvidia-nim.manage";
export const REFRESH_MODELS_COMMAND_ID = "nvidia-nim.refreshModels";
export const TOGGLE_DEBUG_LOGGING_COMMAND_ID = "nvidia-nim.toggleDebugLogging";
export const OPEN_DEBUG_LOG_COMMAND_ID = "nvidia-nim.openDebugLog";
export const TOGGLE_SHOW_REASONING_COMMAND_ID = "nvidia-nim.toggleShowReasoning";

export const BASE_URL = "https://integrate.api.nvidia.com/v1";
export const EXTENSION_VERSION: string = pkg.version;

/** Safety margin for context window calculations (in tokens) */
export const CONTEXT_WINDOW_SAFETY_MARGIN = 4096;

/** Maximum retry delay in milliseconds */
export const MAX_RETRY_DELAY_MS = 30000;

/** Base retry delay in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 120000;

/** Maximum time (ms) between stream chunks before timeout */
export const STREAM_IDLE_TIMEOUT_MS = 120000;

export const STREAM_IDLE_TIMEOUT_MIN_MS = 60000;
export const STREAM_IDLE_TIMEOUT_MAX_MS = 300000;

/**
 * Models that emit `reasoning_content` and consume part of the output budget
 * on internal reasoning before producing visible text/tool calls.  They get a
 * minimum output budget floor so long reasoning steps cannot exhaust the
 * budget and truncate the visible response.
 */
const THINKING_MODEL_ID_PATTERNS = [
  /(^|[\/_-])deepseek-r1([\/_-]|$)/i,
  // DeepSeek V4 (Flash) exposes visible reasoning through reasoning_content
  /(^|[\/_-])deepseek-v4([\/_-]|$)/i,
  // Moonshot Kimi K2 / K3 / K2.6 native thinking mode (1M context, vision)
  /(^|[\/_-])kimi-k\d([.\/_-]|$)/i,
  // Zhipu GLM-5.x reasoning models
  /(^|[\/_-])glm-5([.\/_-]|$)/i,
  // OpenAI GPT-OSS open-weight thinking models
  /(^|[\/_-])gpt-oss([\/_-]|$)/i,
  // MiniMax M3 reasoning model
  /(^|[\/_-])minimax-m3([\/_-]|$)/i,
  // NVIDIA Nemotron 3 reasoning family
  /(^|[\/_-])nemotron-3([\/_-]|$)/i,
  // Llama 3.3 Nemotron Super 49B (reasoning-tuned)
  /(^|[\/_-])nemotron-super([\/_-]|$)/i,
  // NVIDIA Cosmos Reason2 VLM (reasoning + vision, Qwen3-VL based)
  /(^|[\/_-])cosmos-reason\d*([\/_-]|$)/i,
  /(^|[\/_-])qwq([\/_-]|$)/i,
];

export const THINKING_MODELS = {
  has(modelId: string): boolean {
    return THINKING_MODEL_ID_PATTERNS.some((pattern) => pattern.test(modelId));
  },
};

export const STATUS_BAR_DEFAULT_TEXT = `$(loading~spin) NVIDIA NIM`;
export const STATUS_BAR_ERROR_TEXT = `$(error) NVIDIA NIM`;

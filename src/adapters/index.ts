import { NvidiaNimChatMessage } from "../types";

export interface NvidiaModelRequestProfile {
  defaultTemperature: number;
  toolTemperature?: number;
  extraSystemMessages: string[];
}

export interface ModelAdapter {
  matches(modelId: string): boolean;
  getProfile(options: { toolsEnabled?: boolean }): NvidiaModelRequestProfile;
  applyMessagesWorkaround?(messages: NvidiaNimChatMessage[]): NvidiaNimChatMessage[];
}

interface FamilyProfile {
  pattern: RegExp;
  defaultTemperature: number;
  toolTemperature?: number;
  toolSystemMessage?: string;
  applyMessagesWorkaround?(messages: NvidiaNimChatMessage[]): NvidiaNimChatMessage[];
}

/**
 * Kimi models reject assistant history entries without `reasoning_content`;
 * inject a placeholder so multi-turn agentic chats do not fail.
 */
function kimiReasoningWorkaround(messages: NvidiaNimChatMessage[]): NvidiaNimChatMessage[] {
  let patchedMessages: NvidiaNimChatMessage[] | undefined;
  for (const [index, msg] of messages.entries()) {
    if (msg.role !== "assistant" || msg.reasoning_content) {
      continue;
    }
    patchedMessages ??= [...messages];
    patchedMessages[index] = { ...msg, reasoning_content: " " };
  }
  return patchedMessages ?? messages;
}

// Order matters: the first matching profile wins (e.g. `mistral-nemotron`
// must hit the Nemotron profile before the Mistral one).
const FAMILY_PROFILES: readonly FamilyProfile[] = [
  {
    pattern: /(^|[\/_-])deepseek([\/_-]|$)/i,
    defaultTemperature: 0,
    toolTemperature: 0,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, either answer with normal user-facing text or emit a tool call. Use the native tool call format (tool_calls array in the API response). Do NOT emit tool calls as inline text markers (tool_call_begin, 伏, 第), plain JSON blocks, or markdown code fences masquerading as tool calls. Do not reveal internal control tokens, protocol markers, JSON fences, planning text, or DSML/tool_call markers in the user-visible response.",
  },
  {
    pattern: /(^|[\/_-])kimi([\/_-]|$)/i,
    defaultTemperature: 0.2,
    toolTemperature: 0.1,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a native tool call. Only emit tool calls through the designated tool_calls field; never write JSON arguments inline as markdown, backtick fences, or plain text. Every tool call must include ALL required arguments with correct types. Do not reveal chain-of-thought, reasoning scratchpads, or internal reasoning markers in the user-visible response.",
    applyMessagesWorkaround: kimiReasoningWorkaround,
  },
  {
    pattern: /(^|[\/_-])glm([\/_-]|$)/i,
    defaultTemperature: 0.1,
    toolTemperature: 0.05,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When calling tools, emit strict JSON arguments only. Do not wrap tool arguments in markdown fences, backticks, or explanatory prose.",
  },
  {
    pattern: /(^|[\/_-])llama([\/_-]|$)/i,
    defaultTemperature: 0.2,
    toolTemperature: 0.1,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or valid tool calls only. Do not emit pseudo tool syntax, XML-like wrappers, or tool planning markers.",
  },
  {
    pattern: /(^|[\/_-])nemotron([\/_-]|$)/i,
    defaultTemperature: 0.2,
    toolTemperature: 0.1,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Do not wrap tool arguments in markdown fences, backticks, or explanatory prose.",
  },
  {
    pattern: /(^|[\/_-])claude([\/_-]|$)/i,
    defaultTemperature: 0.3,
    toolTemperature: 0.2,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. Prefer simple solutions. When tools are available, emit a valid tool call with complete JSON arguments or respond with concise text. Ensure every required argument is present with the correct type. Do not include meta-commentary about your capabilities.",
  },
  {
    pattern: /(^|[\/_-])gpt([\/_-]|$)/i,
    defaultTemperature: 0.3,
    toolTemperature: 0.2,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, emit a valid tool call or respond with concise text. Do not include disclaimers or apologies.",
  },
  {
    pattern: /(^|[\/_-])(mistral|mixtral|codestral)([\/_-]|$)/i,
    defaultTemperature: 0.3,
    toolTemperature: 0.2,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Do not include disclaimers, apologies, or meta-commentary about your capabilities in the response.",
  },
  {
    pattern: /(^|[\/_-])qwen([\/_-]|$)/i,
    defaultTemperature: 0.1,
    toolTemperature: 0.05,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When calling tools, emit a valid JSON arguments object only. Do not wrap tool arguments in markdown fences, backticks, or explanatory prose. Do not provide multiple alternative actions for the user to choose from.",
  },
  {
    pattern: /(^|[\/_-])minimax([\/_-]|$)/i,
    defaultTemperature: 0.6,
    toolTemperature: 0.4,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Emit tool calls with complete JSON arguments; do not wrap them in markdown fences, backticks, or explanatory prose.",
  },
  {
    pattern: /(^|[\/_-])phi([\/_-]|$)/i,
    defaultTemperature: 0.3,
    toolTemperature: 0.2,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Keep responses brief and direct. Do not ask follow-up questions unless necessary.",
  },
  {
    pattern: /(^|[\/_-])yi([\/_-]|$)/i,
    defaultTemperature: 0.3,
    toolTemperature: 0.2,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Do not wrap tool arguments in markdown fences or backticks.",
  },
  {
    pattern: /(^|[\/_-])gemma([\/_-]|$)/i,
    defaultTemperature: 0.3,
    toolTemperature: 0.15,
    toolSystemMessage:
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When calling tools, emit a valid JSON arguments object only. Do not include chain-of-thought reasoning or internal scratchpad text in the visible response.",
  },
];

const DEFAULT_PROFILE: FamilyProfile = {
  pattern: /.*/,
  defaultTemperature: 0.7,
  toolTemperature: 0.3,
  toolSystemMessage:
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. Prefer simple solutions. Analyze the problem before coding. When tools are available, answer with concise user-facing text or a valid tool call. Do not include disclaimers or apologies.",
};

function createAdapter(profile: FamilyProfile): ModelAdapter {
  const adapter: ModelAdapter = {
    matches(modelId: string): boolean {
      return profile.pattern.test(modelId);
    },
    getProfile(options: { toolsEnabled?: boolean }): NvidiaModelRequestProfile {
      return {
        defaultTemperature: profile.defaultTemperature,
        toolTemperature: profile.toolTemperature,
        extraSystemMessages:
          options.toolsEnabled && profile.toolSystemMessage ? [profile.toolSystemMessage] : [],
      };
    },
  };
  if (profile.applyMessagesWorkaround) {
    adapter.applyMessagesWorkaround = profile.applyMessagesWorkaround;
  }
  return adapter;
}

const ADAPTERS: readonly ModelAdapter[] = FAMILY_PROFILES.map(createAdapter);
const DEFAULT_ADAPTER = createAdapter(DEFAULT_PROFILE);

export function getModelAdapter(modelId: string): ModelAdapter {
  const normalizedModelId = modelId.toLowerCase();
  return ADAPTERS.find((adapter) => adapter.matches(normalizedModelId)) ?? DEFAULT_ADAPTER;
}

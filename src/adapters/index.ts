import { NvidiaNimChatMessage } from "../types";
import { ParsedTextToolCallResult } from "../tool-parser";

export interface NvidiaModelRequestProfile {
  defaultTemperature: number;
  toolTemperature?: number;
  extraSystemMessages: string[];
}

export interface ModelAdapter {
  readonly idPattern: RegExp;
  matches(modelId: string): boolean;
  getProfile(options: { toolsEnabled?: boolean }): NvidiaModelRequestProfile;
  applyMessagesWorkaround?(messages: NvidiaNimChatMessage[]): NvidiaNimChatMessage[];
  parseTextEmbeddedToolCalls?(text: string): ParsedTextToolCallResult;
}

const DEFAULT_TEMPERATURE = 0.7;

abstract class BaseModelAdapter implements ModelAdapter {
  abstract readonly idPattern: RegExp;
  abstract readonly defaultTemperature: number;
  readonly toolTemperature?: number;
  readonly toolSystemMessage?: string;

  getProfile(options: { toolsEnabled?: boolean }): NvidiaModelRequestProfile {
    return {
      defaultTemperature: this.defaultTemperature,
      toolTemperature: this.toolTemperature,
      extraSystemMessages:
        options.toolsEnabled && this.toolSystemMessage ? [this.toolSystemMessage] : [],
    };
  }

  matches(modelId: string): boolean {
    return this.idPattern.test(modelId);
  }
}

export class DeepSeekAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])deepseek([\/_-]|$)/i;
  readonly defaultTemperature = 0;
  readonly toolTemperature = 0;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, either answer with normal user-facing text or emit a tool call. Use the native tool call format (tool_calls array in the API response). Do NOT emit tool calls as inline text markers (tool_call_begin, 伏, 第), plain JSON blocks, or markdown code fences masquerading as tool calls. Do not reveal internal control tokens, protocol markers, JSON fences, planning text, or DSML/tool_call markers in the user-visible response.";
}

export class KimiAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])kimi([\/_-]|$)/i;
  readonly defaultTemperature = 0.2;
  readonly toolTemperature = 0.1;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a native tool call. Only emit tool calls through the designated tool_calls field; never write JSON arguments inline as markdown, backtick fences, or plain text. Every tool call must include ALL required arguments with correct types. Do not reveal chain-of-thought, reasoning scratchpads, or internal reasoning markers in the user-visible response.";

  applyMessagesWorkaround(messages: NvidiaNimChatMessage[]): NvidiaNimChatMessage[] {
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
}

export class GlmAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])glm([\/_-]|$)/i;
  readonly defaultTemperature = 0.1;
  readonly toolTemperature = 0.05;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When calling tools, emit strict JSON arguments only. Do not wrap tool arguments in markdown fences, backticks, or explanatory prose.";
}

export class LlamaAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])llama([\/_-]|$)/i;
  readonly defaultTemperature = 0.2;
  readonly toolTemperature = 0.1;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or valid tool calls only. Do not emit pseudo tool syntax, XML-like wrappers, or tool planning markers.";
}

export class MistralAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])(mistral|mixtral|codestral)([\/_-]|$)/i;
  readonly defaultTemperature = 0.3;
  readonly toolTemperature = 0.2;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Do not include disclaimers, apologies, or meta-commentary about your capabilities in the response.";
}

export class QwenAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])qwen([\/_-]|$)/i;
  readonly defaultTemperature = 0.1;
  readonly toolTemperature = 0.05;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When calling tools, emit a valid JSON arguments object only. Do not wrap tool arguments in markdown fences, backticks, or explanatory prose. Do not provide multiple alternative actions for the user to choose from.";
}

export class MiniMaxAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])minimax([\/_-]|$)/i;
  readonly defaultTemperature = 0.6;
  readonly toolTemperature = 0.4;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Emit tool calls with complete JSON arguments; do not wrap them in markdown fences, backticks, or explanatory prose.";
}

export class PhiAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])phi([\/_-]|$)/i;
  readonly defaultTemperature = 0.3;
  readonly toolTemperature = 0.2;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Keep responses brief and direct. Do not ask follow-up questions unless necessary.";
}

export class YiAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])yi([\/_-]|$)/i;
  readonly defaultTemperature = 0.3;
  readonly toolTemperature = 0.2;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Do not wrap tool arguments in markdown fences or backticks.";
}

export class GemmaAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])gemma([\/_-]|$)/i;
  readonly defaultTemperature = 0.3;
  readonly toolTemperature = 0.15;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When calling tools, emit a valid JSON arguments object only. Do not include chain-of-thought reasoning or internal scratchpad text in the visible response.";
}

export class NemotronAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])nemotron([\/_-]|$)/i;
  readonly defaultTemperature = 0.2;
  readonly toolTemperature = 0.1;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, answer with concise user-facing text or a valid tool call. Do not wrap tool arguments in markdown fences, backticks, or explanatory prose.";
}

export class ClaudeAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])claude([\/_-]|$)/i;
  readonly defaultTemperature = 0.3;
  readonly toolTemperature = 0.2;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. Prefer simple solutions. When tools are available, emit a valid tool call with complete JSON arguments or respond with concise text. Ensure every required argument is present with the correct type. Do not include meta-commentary about your capabilities.";
}

export class GptAdapter extends BaseModelAdapter {
  readonly idPattern = /(^|[\/_-])gpt([\/_-]|$)/i;
  readonly defaultTemperature = 0.3;
  readonly toolTemperature = 0.2;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. When tools are available, emit a valid tool call or respond with concise text. Do not include disclaimers or apologies.";
}

export class DefaultAdapter extends BaseModelAdapter {
  readonly idPattern = /.*/;
  readonly defaultTemperature = DEFAULT_TEMPERATURE;
  readonly toolTemperature = 0.3;
  readonly toolSystemMessage =
    "You are an expert AI programming assistant. Provide correct, concise, production-ready code. Prefer simple solutions. Analyze the problem before coding. When tools are available, answer with concise user-facing text or a valid tool call. Do not include disclaimers or apologies.";
}

const ADAPTERS: ModelAdapter[] = [
  new DeepSeekAdapter(),
  new KimiAdapter(),
  new GlmAdapter(),
  new LlamaAdapter(),
  new NemotronAdapter(),
  new ClaudeAdapter(),
  new GptAdapter(),
  new MistralAdapter(),
  new QwenAdapter(),
  new MiniMaxAdapter(),
  new PhiAdapter(),
  new YiAdapter(),
  new GemmaAdapter(),
];

const DEFAULT_ADAPTER = new DefaultAdapter();
const adapterCache = new Map<string, ModelAdapter>();
const MAX_ADAPTER_CACHE_SIZE = 64;

export function getModelAdapter(modelId: string): ModelAdapter {
  const cached = adapterCache.get(modelId);
  if (cached) {
    return cached;
  }

  const normalizedModelId = modelId.toLowerCase();
  const matched = ADAPTERS.find((adapter) => adapter.matches(normalizedModelId));
  const result = matched ?? DEFAULT_ADAPTER;

  if (adapterCache.size >= MAX_ADAPTER_CACHE_SIZE) {
    const firstKey = adapterCache.keys().next().value;
    if (firstKey !== undefined) {
      adapterCache.delete(firstKey);
    }
  }
  adapterCache.set(modelId, result);
  return result;
}

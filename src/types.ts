export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface NvidiaNimContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface NvidiaNimChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | NvidiaNimContentPart[];
  name?: string;
  tool_calls?: NvidiaNimToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface NvidiaNimToolCall {
  id: string;
  /** Optional index used in streaming tool call deltas */
  index?: number;
  type: "function";
  function: { name: string; arguments: string };
}

export interface NvidiaNimTool {
  type: "function";
  function: { name: string; description?: string; parameters?: JsonObject };
}

export interface NvidiaNimChatRequest {
  model: string;
  messages: NvidiaNimChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: NvidiaNimTool[];
  tool_choice?: "auto" | "none" | "required" | { type: string; function: { name: string } };
}

export interface NvidiaNimStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: NvidiaNimToolCall[];
  };
  finish_reason: string | null;
}

export interface NvidiaNimStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: NvidiaNimStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface NvidiaModelCapabilities {
  chat?: boolean;
  vision?: boolean;
  tool_calling?: boolean;
}

export interface NvidiaModelMetadata {
  context_window?: number;
  max_output_tokens?: number;
  max_tokens?: number;
}

export interface NvidiaModelSummary {
  id: string;
  name?: string;
  capabilities?: NvidiaModelCapabilities;
  metadata?: NvidiaModelMetadata;
}

export interface NvidiaModelListResponse {
  data?: NvidiaModelSummary[];
}

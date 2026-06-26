import * as vscode from "vscode";
import {
  extractImageData,
  getDataPartTextValue,
  getTextPartValue,
  getToolCallInfo,
  getToolResultEntries,
  type LegacyPart,
} from "./message-parts";
import { debugLog } from "./output-channel";
import { JsonObject, NvidiaNimChatMessage, NvidiaNimContentPart, NvidiaNimTool } from "./types";

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildToolDescription(
  description: string | undefined,
  inputSchema: unknown,
): string | undefined {
  const schema = asObjectRecord(inputSchema);
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

  const guidance: string[] = [];
  if (schema?.type === "object") {
    guidance.push("Return a valid JSON object that matches this schema.");
    if (required.length > 0) {
      guidance.push(`Required arguments: ${required.join(", ")}.`);
      guidance.push("Do not call this tool with an empty object.");
    }

    const properties = asObjectRecord(schema.properties);
    const propertyNames = properties ? Object.keys(properties) : [];
    const highlightedNames = propertyNames
      .filter((name) => required.includes(name) || propertyNames.length <= 5)
      .slice(0, 5);
    if (highlightedNames.length > 0) {
      const propertyLines = highlightedNames.map((name) => {
        const propertySchema = asObjectRecord(properties?.[name]);
        const propertyType = typeof propertySchema?.type === "string" ? propertySchema.type : "any";
        const propertyDescription =
          typeof propertySchema?.description === "string" ? propertySchema.description.trim() : "";
        const enumValues = Array.isArray(propertySchema?.enum)
          ? propertySchema.enum.filter(
              (item): item is string => typeof item === "string" && item.length > 0,
            )
          : [];
        const enumGuidance =
          enumValues.length > 0 ? ` Allowed values: ${enumValues.join(", ")}.` : "";
        return propertyDescription
          ? `- ${name} (${propertyType}): ${propertyDescription}${enumGuidance}`
          : `- ${name} (${propertyType})${enumGuidance}`;
      });
      guidance.push(`Arguments:\n${propertyLines.join("\n")}`);
    }
  }

  const baseDescription = typeof description === "string" ? description.trim() : "";
  const guidanceText = guidance.join("\n");
  if (baseDescription && guidanceText) {
    return `${baseDescription}\n\n${guidanceText}`;
  }
  return baseDescription || guidanceText || undefined;
}

export interface ExtractedMessageContent {
  content: string;
  reasoningContent?: string;
}

export const reasoningCache = new Map<string, string>();

export function extractReasoningContent(text: string): ExtractedMessageContent {
  // 1. Try HTML details block
  const detailsRegex =
    /<details\s+data-reasoning="true"\s*>[\s\S]*?<summary>.*?<\/summary>\s*([\s\S]*?)\s*<\/details>/i;
  const globalDetailsRegex =
    /<details\s+data-reasoning="true"\s*>[\s\S]*?<summary>.*?<\/summary>\s*([\s\S]*?)\s*<\/details>/gi;
  let match = detailsRegex.exec(text);
  if (match) {
    const reasoningContent = match[1].trim();
    const content = text.replace(globalDetailsRegex, "").trim();
    return { content, reasoningContent };
  }

  // 2. Try Markdown blockquote
  const markdownRegex =
    />\s*\*\*\[思考プロセス\s+\(Thinking\s+Process\)\]\*\*\s*\n((?:>\s*.*(?:\n|$))*)/i;
  const globalMarkdownRegex =
    />\s*\*\*\[思考プロセス\s+\(Thinking\s+Process\)\]\*\*\s*\n(?:>\s*.*(?:\n|$))*/gi;

  match = markdownRegex.exec(text);
  if (match) {
    const reasoningContent = match[1]
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join("\n")
      .trim();

    let content = text.replace(globalMarkdownRegex, "").trim();
    content = content
      .replace(/^---\s*/, "")
      .replace(/\s*---\s*$/, "")
      .trim();
    return { content, reasoningContent };
  }

  return { content: text };
}

export function convertMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  options?: { maxToolResultChars?: number; supportsVision?: boolean },
): NvidiaNimChatMessage[] {
  const result: NvidiaNimChatMessage[] = [];

  for (const message of messages) {
    const role =
      message.role === vscode.LanguageModelChatMessageRole.User
        ? "user"
        : message.role === vscode.LanguageModelChatMessageRole.Assistant
          ? "assistant"
          : "system";

    const textParts: string[] = [];
    const imageParts: NvidiaNimContentPart[] = [];

    for (const part of message.content) {
      if (
        getToolCallInfo(part) ||
        getToolResultEntries([part as vscode.LanguageModelInputPart]).length > 0
      ) {
        continue;
      }
      const textValue = getTextPartValue(part) ?? getDataPartTextValue(part);
      if (textValue !== undefined) {
        textParts.push(textValue);
        continue;
      }
      const image = extractImageData(part);
      if (image && options?.supportsVision) {
        imageParts.push({
          type: "image_url",
          image_url: {
            url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
          },
        });
        continue;
      }
      debugLog("convertLanguageModelMessage", `Unrecognized message part: ${JSON.stringify(part)}`);
    }

    const toolCalls = message.content
      .map((part) => getToolCallInfo(part))
      .filter(
        (toolCall): toolCall is { id?: string; name?: string; args?: Record<string, unknown> } =>
          Boolean(toolCall),
      );

    const rawTextContent = textParts.join("");
    const extracted = extractReasoningContent(rawTextContent);
    const content = extracted.content;
    let reasoningContent = extracted.reasoningContent;
    if (!reasoningContent && role === "assistant") {
      const cached = reasoningCache.get(rawTextContent.trim());
      if (cached) {
        reasoningContent = cached;
      }
    }

    if (toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: content,
        tool_calls: toolCalls.map((toolCall) => ({
          id: toolCall.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          type: "function",
          function: {
            name: toolCall.name ?? "unknown",
            arguments: JSON.stringify(toolCall.args ?? {}),
          },
        })),
        reasoning_content: reasoningContent || " ",
      });
    }

    const toolResults = getToolResultEntries(
      message.content as Array<vscode.LanguageModelInputPart | LegacyPart>,
    );
    for (const toolResult of toolResults) {
      let content = toolResult.content || "";
      if (options?.maxToolResultChars && content.length > options.maxToolResultChars) {
        content = content.slice(0, options.maxToolResultChars) + "…";
      }
      result.push({ role: "tool", tool_call_id: toolResult.callId, content });
    }

    const hasTextOrImage = content.length > 0 || imageParts.length > 0;
    const isAssistantWithToolCalls = role === "assistant" && toolCalls.length > 0;

    if (hasTextOrImage && !isAssistantWithToolCalls) {
      if (imageParts.length > 0) {
        const contentParts: NvidiaNimContentPart[] = [];
        if (content) contentParts.push({ type: "text", text: content });
        contentParts.push(...imageParts);
        result.push({
          role,
          content: contentParts,
          ...(role === "assistant" && reasoningContent
            ? { reasoning_content: reasoningContent }
            : {}),
        });
      } else {
        result.push({
          role,
          content: content,
          ...(role === "assistant" && reasoningContent
            ? { reasoning_content: reasoningContent }
            : {}),
        });
      }
    } else if (!isAssistantWithToolCalls && toolResults.length === 0 && !hasTextOrImage) {
      if (role === "assistant" && reasoningContent) {
        result.push({
          role,
          content: "",
          reasoning_content: reasoningContent,
        });
      } else {
        result.push({ role, content: "" });
      }
    }
  }

  return result;
}

export function applyReasoningContentWorkaround(
  messages: NvidiaNimChatMessage[],
  _modelId: string,
): NvidiaNimChatMessage[] {
  // Can be extended if specific NVIDIA models need it
  return messages;
}

export function convertTools(options: vscode.ProvideLanguageModelChatResponseOptions): {
  tools?: NvidiaNimTool[];
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
} {
  const toolsInput = options.tools ?? [];
  if (toolsInput.length === 0) {
    return {};
  }

  const tools: NvidiaNimTool[] = toolsInput.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: buildToolDescription(tool.description, tool.inputSchema),
      parameters: tool.inputSchema as JsonObject,
    },
  }));

  const requiredToolMode = (
    vscode as unknown as {
      LanguageModelChatToolMode?: { Required?: number };
    }
  ).LanguageModelChatToolMode?.Required;

  if (requiredToolMode !== undefined && options.toolMode === requiredToolMode) {
    return { tools, tool_choice: "required" };
  }

  return { tools, tool_choice: "auto" };
}

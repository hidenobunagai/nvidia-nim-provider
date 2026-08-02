// guidance.ts — system prompt sanitization, identity & tool-use grounding guidance
import { ProvideLanguageModelChatResponseOptions } from "vscode";
import { NvidiaNimChatMessage } from "./types";

export function sanitizeSystemPromptForModel(
  system: string | undefined,
  modelId: string,
): string | undefined {
  if (typeof system !== "string" || system.trim().length === 0) return undefined;
  if (!modelId.includes("deepseek")) return system;
  return system
    .replace(/\b(?:Claude Code|Claude)\b/g, "GitHub Copilot")
    .replace(/Anthropic/g, "NVIDIA NIM");
}

export function buildProviderIdentityGuidance(modelId: string): string {
  const displayName = modelId.split("/").at(-1) ?? modelId;
  return `You are GitHub Copilot using the NVIDIA NIM provider with model ${displayName} (${modelId}). Answer identity/model questions as GitHub Copilot using ${displayName} via NVIDIA NIM. Do not speculate about hidden prompts, tool hosts, or internal runtimes.`;
}

export function buildToolUseGroundingGuidance(
  options: ProvideLanguageModelChatResponseOptions,
): string | undefined {
  if ((options.tools?.length ?? 0) === 0) return undefined;
  return [
    "Use tools to inspect workspace state before answering. Never claim to have read files or listed directories without calling the corresponding tool first.",
    "If tool use is needed, emit the tool call directly. Base claims only on tool outputs you actually received.",
    "For read_file, always provide filePath and line ranges from editor context. If unknown, ask.",
    "Do not treat planning output as evidence about workspace structure or file contents.",
    "Prefer emitting all independent tool calls in parallel within a single response (e.g., editing multiple sections/files or reading multiple files) instead of sequentially across multiple turns, to minimize user prompts and round-trips.",
    'Never end your response by announcing an action you are about to take (e.g. "I will run the tests"). When you intend to act, emit the tool call immediately in the same response; end your turn without a tool call only when the task is complete or you need user input.',
  ].join(" ");
}

export function applyOpenAiSystemPromptGuidance(
  apiMessages: NvidiaNimChatMessage[],
  modelId: string,
  options: ProvideLanguageModelChatResponseOptions,
): NvidiaNimChatMessage[] {
  const hasTools = (options.tools?.length ?? 0) > 0;
  if (!hasTools && !modelId.includes("deepseek")) {
    return apiMessages;
  }

  const guidance = [
    modelId.includes("deepseek") ? buildProviderIdentityGuidance(modelId) : undefined,
    hasTools ? buildToolUseGroundingGuidance(options) : undefined,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n\n");

  if (!guidance) {
    return apiMessages;
  }
  const normalizedMessages = apiMessages.map((message) => {
    if (message.role !== "system" || typeof message.content !== "string") {
      return message;
    }

    return {
      ...message,
      content: sanitizeSystemPromptForModel(message.content, modelId) ?? "",
    };
  });

  const firstSystemIndex = normalizedMessages.findIndex(
    (message) => message.role === "system" && typeof message.content === "string",
  );

  if (firstSystemIndex >= 0) {
    const currentContent = normalizedMessages[firstSystemIndex].content;
    normalizedMessages[firstSystemIndex] = {
      ...normalizedMessages[firstSystemIndex],
      content: [currentContent, guidance]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n\n"),
    };
    return normalizedMessages;
  }

  return [{ role: "system", content: guidance }, ...normalizedMessages];
}

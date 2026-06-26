import * as vscode from "vscode";
import { streamChatCompletion } from "../api";
import { DEBUG_ENV_VAR } from "../constants";
import { convertMessages, convertTools, reasoningCache } from "../openai-conversion";
import { debugLog } from "../output-channel";
import {
  extractChatRequestContext,
  getToolSchemaMap,
  isToolCallInput,
  buildInvalidToolCallFallback,
  buildInvalidToolCallRetryMessage,
  type ToolSchema,
  type ChatRequestContext,
} from "../tool-repair";
import { setupStreamState } from "./shared";
import { NvidiaNimChatMessage, NvidiaNimChatRequest } from "../types";
import { getModelAdapter } from "../adapters";
import { estimateMessagesTokens } from "../tokenizer";

export interface OpenAIModelInfo {
  id: string;
  maxOutputTokens: number;
}

export async function processOpenAIStream(
  model: OpenAIModelInfo,
  apiMessages: readonly vscode.LanguageModelChatMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  apiKey: string,
  requestedMaxTokens: number,
  temperatureVal: number,
  userAgent: string,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
  abortController: AbortController,
  maxToolResultChars: number,
  supportsVision: boolean,
  requestPreparationStartedAtMs: number,
): Promise<void> {
  let requestPreparationDurationMs: number | undefined;
  let toolParsingStateInitDurationMs: number | undefined;

  let toolParsingState:
    | {
        toolSchemas: Map<string, ToolSchema>;
        requestContext: ChatRequestContext | undefined;
      }
    | undefined;

  const getToolParsingState = () => {
    if (toolParsingState) {
      return toolParsingState;
    }
    const toolParsingStateStartedAtMs = Date.now();
    const toolSchemas = getToolSchemaMap(options);
    const requestContext = extractChatRequestContext(apiMessages);
    toolParsingStateInitDurationMs = Date.now() - toolParsingStateStartedAtMs;
    toolParsingState = { toolSchemas, requestContext };
    return toolParsingState;
  };

  const inputTokenCount = estimateMessagesTokens(apiMessages);

  let convertedMessages = convertMessages(apiMessages, { maxToolResultChars, supportsVision });

  const toolConfig = convertTools(options);

  const adapter = getModelAdapter(model.id);
  if (adapter.applyMessagesWorkaround) {
    convertedMessages = adapter.applyMessagesWorkaround(convertedMessages);
  }
  const requestProfile = adapter.getProfile({
    toolsEnabled: Boolean(toolConfig.tools?.length),
  });
  if (requestProfile.extraSystemMessages.length > 0) {
    convertedMessages = [
      ...requestProfile.extraSystemMessages.map(
        (content): NvidiaNimChatMessage => ({ role: "system", content }),
      ),
      ...convertedMessages,
    ];
  }

  const MAX_RETRIES = 3;
  let currentMaxTokens = requestedMaxTokens;
  let prevEmittedKeys: Set<string> | undefined;
  let retryReason:
    | "reasoning-only"
    | "mid-response-stop"
    | "empty-response"
    | "invalid_tool_call"
    | undefined;
  let deferredInvalidToolFallbackText: string | undefined;
  const attemptSnapshots: Array<Record<string, unknown>> = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    const attemptStartedAtMs = Date.now();
    let fullContent = "";

    if (attempt > 0) {
      currentMaxTokens = Math.min(currentMaxTokens * 2, model.maxOutputTokens);
      debugLog("processOpenAIStream retry", {
        attempt,
        retryReason,
      });
    }

    if (requestPreparationDurationMs === undefined && requestPreparationStartedAtMs !== undefined) {
      requestPreparationDurationMs = attemptStartedAtMs - requestPreparationStartedAtMs;
    }

    const requestBody: NvidiaNimChatRequest = {
      model: model.id,
      messages: convertedMessages,
      stream: true,
      temperature: temperatureVal,
      max_tokens: currentMaxTokens,
    };

    const modelOpts = options.modelOptions as Record<string, unknown>;
    if (typeof modelOpts?.top_p === "number") {
      requestBody.top_p = Math.min(1, Math.max(0, modelOpts.top_p));
    }
    if (typeof modelOpts?.frequency_penalty === "number") {
      requestBody.frequency_penalty = Math.min(2, Math.max(-2, modelOpts.frequency_penalty));
    }
    if (typeof modelOpts?.presence_penalty === "number") {
      requestBody.presence_penalty = Math.min(2, Math.max(-2, modelOpts.presence_penalty));
    }
    const stopVal = modelOpts?.stop;
    if (typeof stopVal === "string" || (Array.isArray(stopVal) && stopVal.length > 0)) {
      requestBody.stop = stopVal as string | string[];
    }

    if (toolConfig.tools) requestBody.tools = toolConfig.tools;
    if (toolConfig.tool_choice) requestBody.tool_choice = toolConfig.tool_choice;

    if (process.env[DEBUG_ENV_VAR] === "1" && attempt === 0) {
      debugLog("Outgoing request messages", {
        messages: requestBody.messages,
        tools: requestBody.tools,
        tool_choice: requestBody.tool_choice,
      });
    }

    const state = setupStreamState(progress, getToolParsingState, apiMessages);
    if (prevEmittedKeys) {
      for (const key of prevEmittedKeys) {
        state.emittedCanonicalKeys.add(key);
      }
    }
    const indexToId = new Map<number, string>();
    let finishReason: string | null = null;

    let firstResponseAtMs: number | undefined;
    let lastUsage:
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;

    try {
      for await (const chunk of streamChatCompletion(
        apiKey,
        requestBody,
        abortController.signal,
        userAgent,
        { maxOutputTokens: model.maxOutputTokens },
      )) {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        if (firstResponseAtMs === undefined) {
          firstResponseAtMs = Date.now();
        }
        if (chunk.usage) {
          lastUsage = chunk.usage;
        }

        const choice = chunk.choices?.[0];

        if (typeof choice?.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }

        if (choice?.delta?.content) {
          fullContent += choice.delta.content;
          state.handleTextDelta(choice.delta.content);
        }

        if (choice?.delta?.reasoning_content) {
          state.handleReasoningDelta(choice.delta.reasoning_content);
        }

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = (tc as { index?: number }).index ?? 0;

            const callId =
              tc.id && typeof tc.id === "string"
                ? (indexToId.set(idx, tc.id), tc.id)
                : (indexToId.get(idx) ?? String(idx));

            if (state.completedNativeCallIds.has(callId)) continue;

            const existing = state.nativeToolCalls.get(callId);
            if (existing) {
              if (tc.function?.arguments && typeof tc.function.arguments === "string") {
                existing.args += tc.function.arguments;
              }
            } else if (tc.id && typeof tc.id === "string") {
              state.nativeToolCalls.set(callId, {
                id: tc.id,
                name: tc.function?.name ?? "",
                args: tc.function?.arguments ?? "",
              });
            }

            const buf = state.nativeToolCalls.get(callId);
            if (!buf || !buf.args.trim()) continue;

            // Wait until the JSON is structurally complete
            const trimmedArgs = buf.args.trim();
            const looksComplete =
              (trimmedArgs.startsWith("{") && trimmedArgs.endsWith("}")) ||
              (trimmedArgs.startsWith("[") && trimmedArgs.endsWith("]")) ||
              trimmedArgs === "null" ||
              trimmedArgs === "true" ||
              trimmedArgs === "false" ||
              /^-?\d+(?:\.\d+)?$/.test(trimmedArgs) ||
              (trimmedArgs.startsWith('"') && trimmedArgs.endsWith('"'));

            if (!looksComplete) continue;

            try {
              const args = JSON.parse(buf.args) as unknown;
              if (buf.id && buf.name && isToolCallInput(args)) {
                const emitted = state.tryEmitNativeToolCall(buf.id, buf.name, args);
                if (emitted) {
                  state.completedNativeCallIds.add(callId);
                }
              }
              state.nativeToolCalls.delete(callId);
            } catch {
              // Not complete JSON yet — wait for next chunk
            }
          }
        }
      }

      // Flush remaining buffered tool calls at stream end
      for (const [callId, buf] of Array.from(state.nativeToolCalls.entries())) {
        if (state.completedNativeCallIds.has(callId)) continue;
        try {
          const args = buf.args ? JSON.parse(buf.args) : {};
          if (buf.id && buf.name && isToolCallInput(args)) {
            state.tryEmitNativeToolCall(buf.id, buf.name, args);
          }
          state.nativeToolCalls.delete(callId);
        } catch {
          debugLog("processOpenAIStream", "Failed to parse incomplete JSON at stream end");
        }
      }

      // Check if retry is needed
      const hasVisibleOutput = state.hasVisibleOutput();
      let shouldRetry = false;

      const fallbackText = state.sawToolCall
        ? buildInvalidToolCallFallback(state.skippedToolCalls)
        : undefined;
      const retryMessage = state.sawToolCall
        ? buildInvalidToolCallRetryMessage(state.skippedToolCalls)
        : undefined;

      const willRetryAfterInvalidToolCall =
        state.sawToolCall &&
        !state.emittedToolCall &&
        attempt === 0 &&
        !state.hasVisibleOutput() &&
        Boolean(fallbackText && retryMessage);

      if (
        !hasVisibleOutput &&
        state.reasoningContent &&
        attempt < MAX_RETRIES &&
        !token.isCancellationRequested
      ) {
        shouldRetry = true;
        retryReason = "reasoning-only";
      } else if (
        !hasVisibleOutput &&
        state.hasIncompleteToolCall() &&
        attempt < MAX_RETRIES &&
        !token.isCancellationRequested
      ) {
        shouldRetry = true;
        retryReason = "mid-response-stop";
      } else if (
        !hasVisibleOutput &&
        !state.sawToolCall &&
        !state.reasoningContent &&
        attempt < MAX_RETRIES &&
        !token.isCancellationRequested
      ) {
        shouldRetry = true;
        retryReason = "empty-response";
      } else if (willRetryAfterInvalidToolCall) {
        shouldRetry = true;
        retryReason = "invalid_tool_call";
        convertedMessages = [
          ...convertedMessages,
          {
            role: "system",
            content: retryMessage!,
          },
        ];
      }

      if (firstResponseAtMs !== undefined) {
        const totalDurationMs = Date.now() - attemptStartedAtMs;
        const generationDurationMs = Math.max(
          0,
          totalDurationMs - (firstResponseAtMs - attemptStartedAtMs),
        );
        const promptTokens = lastUsage?.prompt_tokens;
        const completionTokens = lastUsage?.completion_tokens;
        const totalTokens = lastUsage?.total_tokens;

        debugLog("stream timing", {
          attempt: attempt + 1,
          totalAttempts: attempt + 1,
          requestPreparationDurationMs,
          toolParsingStateInitDurationMs,
          model: model.id,
          inputTokenCount,
          requestedMaxTokens,
          temperature: temperatureVal,
          toolsEnabled: Boolean(toolConfig.tools?.length),
          runtimeMetadataSource: "selected-model",
          isRetryAttempt: attempt > 0,
          willRetryAfterInvalidToolCall,
          skippedToolCallCount: state.skippedToolCalls.length,
          ...(state.skippedToolCalls.length > 0
            ? {
                skippedToolCallNames: Array.from(
                  new Set(state.skippedToolCalls.map((c) => c.name)),
                ),
              }
            : {}),
          ...(retryReason ? { retryReason } : {}),
          firstTokenLatencyMs: firstResponseAtMs - attemptStartedAtMs,
          ...(state.firstToolCallAtMs !== undefined
            ? { firstToolCallLatencyMs: state.firstToolCallAtMs - attemptStartedAtMs }
            : {}),
          totalDurationMs,
          generationDurationMs,
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
          ...(totalTokens !== undefined ? { totalTokens } : {}),
          ...(completionTokens !== undefined && generationDurationMs > 0
            ? {
                completionTokensPerSecond: Number(
                  (completionTokens / (generationDurationMs / 1000)).toFixed(2),
                ),
              }
            : {}),
          reportedContent: state.hasEmittedNormalOutput,
          emittedToolCall: state.emittedToolCall,
        });
      }

      attemptSnapshots.push({
        attempt: attempt + 1,
        retryReason: shouldRetry ? retryReason : null,
        requestBody: JSON.parse(JSON.stringify(requestBody)) as NvidiaNimChatRequest,
        state: {
          hasVisibleOutput,
          sawToolCall: state.sawToolCall,
          emittedToolCall: state.emittedToolCall,
          incompleteToolCall: state.hasIncompleteToolCall(),
          pendingTextChars: state.pendingText.length,
          reasoningChars: state.reasoningContent.length,
          nativeToolCalls: state.nativeToolCalls.size,
          skippedToolCalls: state.skippedToolCalls,
          finishReason,
        },
      });

      if (shouldRetry) {
        state.closeReasoningBlockIfNeeded();
        prevEmittedKeys = state.snapshotEmittedKeys();
        if (willRetryAfterInvalidToolCall) {
          deferredInvalidToolFallbackText = fallbackText;
        }
        continue;
      }

      state.finalize("processOpenAIStream", Boolean(deferredInvalidToolFallbackText));
      if (state.reasoningContent) {
        reasoningCache.set(fullContent.trim(), state.reasoningContent.trim());
      }

      if (state.sawToolCall && !state.emittedToolCall) {
        const textToReport = fallbackText || deferredInvalidToolFallbackText;
        if (textToReport) {
          progress.report(new vscode.LanguageModelTextPart(textToReport));
        }
      } else if (
        deferredInvalidToolFallbackText &&
        !state.emittedToolCall &&
        !state.hasVisibleOutput()
      ) {
        progress.report(new vscode.LanguageModelTextPart(deferredInvalidToolFallbackText));
      }
      return;
    } catch (err) {
      if (token.isCancellationRequested || (err instanceof Error && err.name === "AbortError")) {
        throw new vscode.CancellationError();
      }
      throw err;
    }
  }
}

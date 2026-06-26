import * as vscode from "vscode";
import { debugLog } from "../output-channel";
import { ToolCallScanner, type ParsedTextToolCall } from "../tool-parser";
import {
  buildToolCallCanonicalKey,
  getCompletedToolCallKeys,
  getMissingRequiredToolArguments,
  hasRequiredToolArguments,
  isToolCallInput,
  repairToolArguments,
  type ChatRequestContext,
  type ToolSchema,
} from "../tool-repair";
import { filterThinkTagsFromChunk, flushThinkTagFilter, type ThinkTagFilterState } from "../utils";

export interface SkippedToolCall {
  name: string;
  required: string[];
  missing: string[];
}

export interface NativeToolCall {
  id: string;
  name: string;
  args: string;
}

export function setupStreamState(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  getToolParsingState: () => {
    toolSchemas: Map<string, ToolSchema>;
    requestContext: ChatRequestContext | undefined;
  },
  messages: readonly vscode.LanguageModelChatMessage[],
): StreamState {
  return new StreamState(progress, getToolParsingState, messages);
}

export class StreamState {
  pendingText = "";
  sawToolCall = false;
  emittedToolCall = false;
  hasEmittedOutput = false;
  hasEmittedNormalOutput = false;
  reasoningContent = "";
  reasoningFlushed = false;
  isReasoningActive = false;
  hasReasoningStarted = false;
  skippedToolCalls: SkippedToolCall[] = [];
  firstToolCallAtMs?: number;

  nativeToolCalls = new Map<string, NativeToolCall>();
  completedNativeCallIds = new Set<string>();
  emittedCanonicalKeys = new Set<string>();

  private toolCallScanner = new ToolCallScanner();
  private thinkTagFilterState: ThinkTagFilterState = { insideThinkBlock: false, pendingText: "" };
  private _toolSchemas?: Map<string, ToolSchema>;
  private _requestContext?: ChatRequestContext;
  private _hasResolvedSchemas = false;

  constructor(
    private progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    private getToolParsingState: () => {
      toolSchemas: Map<string, ToolSchema>;
      requestContext: ChatRequestContext | undefined;
    },
    private messages: readonly vscode.LanguageModelChatMessage[],
  ) {}

  private resolveSchemas(): {
    toolSchemas: Map<string, ToolSchema>;
    requestContext: ChatRequestContext | undefined;
  } {
    if (!this._hasResolvedSchemas) {
      const { toolSchemas, requestContext } = this.getToolParsingState();
      this._toolSchemas = toolSchemas;
      this._requestContext = requestContext;
      this._hasResolvedSchemas = true;
      const initialKeys = getCompletedToolCallKeys(this.messages, requestContext, toolSchemas);
      for (const key of initialKeys) {
        this.emittedCanonicalKeys.add(key);
      }
    }
    return { toolSchemas: this._toolSchemas!, requestContext: this._requestContext };
  }

  handleReasoningDelta(text: string): void {
    this.reasoningContent += text;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const LanguageModelThinkingPartClass = (vscode as any).LanguageModelThinkingPart;
    if (LanguageModelThinkingPartClass) {
      this.progress.report(new LanguageModelThinkingPartClass(text));
      this.hasEmittedOutput = true;
      return;
    }

    const showReasoning = vscode.workspace
      .getConfiguration("nvidia-nim")
      .get<boolean>("showReasoning", false);

    if (showReasoning) {
      if (!this.hasReasoningStarted) {
        this.hasReasoningStarted = true;
        this.isReasoningActive = true;
        const startTag = `\n> **[思考プロセス (Thinking Process)]**\n> `;
        this.progress.report(new vscode.LanguageModelTextPart(startTag));
        this.hasEmittedOutput = true;
      }
      const formattedText = text.replace(/\n/g, "\n> ");
      this.progress.report(new vscode.LanguageModelTextPart(formattedText));
    }
  }

  closeReasoningBlockIfNeeded(): void {
    if (this.isReasoningActive) {
      this.isReasoningActive = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const LanguageModelThinkingPartClass = (vscode as any).LanguageModelThinkingPart;
      if (!LanguageModelThinkingPartClass) {
        const endTag = `\n\n---\n\n`;
        this.progress.report(new vscode.LanguageModelTextPart(endTag));
      }
    }
  }

  flushPendingText(reasoningLogLabel: string): void {
    if (!this.reasoningFlushed && this.reasoningContent) {
      this.reasoningFlushed = true;
      debugLog(reasoningLogLabel, {
        reasoning_length: this.reasoningContent.length,
        reasoning_preview: this.reasoningContent.slice(0, 300),
      });
    }
    if (!this.pendingText) return;
    this.progress.report(new vscode.LanguageModelTextPart(this.pendingText));
    this.hasEmittedOutput = true;
    this.hasEmittedNormalOutput = true;
    this.pendingText = "";
  }

  handleTextDelta(text: string): void {
    this.closeReasoningBlockIfNeeded();
    const filteredText = filterThinkTagsFromChunk(text, this.thinkTagFilterState);
    if (!filteredText) return;
    const segments = this.toolCallScanner.feed(filteredText);
    for (const segment of segments) {
      if (segment.type === "text") {
        this.pendingText += segment.text;
      } else if (segment.type === "toolCall") {
        this.emitTextEmbeddedToolCall(segment.toolCall);
      } else if (segment.type === "invalidToolCall") {
        this.sawToolCall = true;
        const { toolSchemas } = this.resolveSchemas();
        const schema = toolSchemas.get((segment as { name: string }).name.toLowerCase());
        this.skippedToolCalls.push({
          name: (segment as { name: string }).name,
          required: schema?.required ?? [],
          missing: schema?.required ?? [],
        });
        debugLog("Skipped invalid text tool call", { name: (segment as { name: string }).name });
      }
    }
  }

  emitTextEmbeddedToolCall(toolCall: ParsedTextToolCall, toolId?: string): void {
    this.closeReasoningBlockIfNeeded();
    this.sawToolCall = true;
    const { toolSchemas, requestContext } = this.resolveSchemas();
    const schema = toolSchemas.get(toolCall.name.toLowerCase());
    const repairedArgs = repairToolArguments(toolCall.name, toolCall.args, requestContext, schema);
    const canonicalKey = buildToolCallCanonicalKey(toolCall.name, repairedArgs);
    if (this.emittedCanonicalKeys.has(canonicalKey)) return;

    if (hasRequiredToolArguments(repairedArgs, schema) && isToolCallInput(repairedArgs)) {
      this.flushPendingText("StreamState");
      this.progress.report(
        new vscode.LanguageModelToolCallPart(
          toolId ?? `text_tool_${Math.random().toString(36).slice(2, 10)}`,
          toolCall.name,
          repairedArgs,
        ),
      );
      this.emittedToolCall = true;
      this.firstToolCallAtMs ??= Date.now();
      this.hasEmittedOutput = true;
      this.hasEmittedNormalOutput = true;
      this.emittedCanonicalKeys.add(canonicalKey);
    } else {
      this.skippedToolCalls.push({
        name: toolCall.name,
        required: schema?.required ?? [],
        missing: getMissingRequiredToolArguments(repairedArgs, schema),
      });
      debugLog("Skipped invalid embedded tool call", toolCall);
    }
  }

  tryEmitNativeToolCall(id: string, name: string, rawArgs: unknown): boolean {
    this.closeReasoningBlockIfNeeded();
    this.sawToolCall = true;
    const { toolSchemas, requestContext } = this.resolveSchemas();
    const schema = toolSchemas.get(name.toLowerCase());
    const repairedArgs = repairToolArguments(name, rawArgs, requestContext, schema);

    if (!isToolCallInput(repairedArgs) || !hasRequiredToolArguments(repairedArgs, schema)) {
      this.skippedToolCalls.push({
        name,
        required: schema?.required ?? [],
        missing: getMissingRequiredToolArguments(repairedArgs, schema),
      });
      debugLog("Skipped invalid native tool call", { id, name, args: repairedArgs });
      return false;
    }

    const canonicalKey = buildToolCallCanonicalKey(name, repairedArgs);
    if (this.emittedCanonicalKeys.has(canonicalKey)) {
      debugLog("Dup suppressed native tool call", { id, name, canonicalKey });
      return false;
    }
    this.emittedCanonicalKeys.add(canonicalKey);

    this.flushPendingText("StreamState");
    this.progress.report(new vscode.LanguageModelToolCallPart(id, name, repairedArgs));
    this.emittedToolCall = true;
    this.firstToolCallAtMs ??= Date.now();
    this.hasEmittedOutput = true;
    this.hasEmittedNormalOutput = true;
    return true;
  }

  snapshotEmittedKeys(): Set<string> {
    this.resolveSchemas();
    return new Set(this.emittedCanonicalKeys);
  }

  hasVisibleOutput(): boolean {
    return this.hasEmittedNormalOutput || this.pendingText.trim().length > 0;
  }

  hasIncompleteToolCall(): boolean {
    return (
      this.nativeToolCalls.size > 0 ||
      (this.sawToolCall && !this.emittedToolCall && this.skippedToolCalls.length === 0)
    );
  }

  finalize(reasoningLogLabel: string, hasDeferredFallback?: boolean): void {
    this.closeReasoningBlockIfNeeded();
    const flushedText = flushThinkTagFilter(this.thinkTagFilterState);
    if (flushedText) {
      const segments = this.toolCallScanner.feed(flushedText);
      for (const segment of segments) {
        if (segment.type === "text") {
          this.pendingText += segment.text;
        } else if (segment.type === "toolCall") {
          this.emitTextEmbeddedToolCall(segment.toolCall);
        } else if (segment.type === "invalidToolCall") {
          this.sawToolCall = true;
          const { toolSchemas } = this.resolveSchemas();
          const schema = toolSchemas.get((segment as { name: string }).name.toLowerCase());
          this.skippedToolCalls.push({
            name: (segment as { name: string }).name,
            required: schema?.required ?? [],
            missing: schema?.required ?? [],
          });
          debugLog("Skipped invalid text tool call", { name: (segment as { name: string }).name });
        }
      }
    }

    const leftoverText = this.toolCallScanner.flushText();
    if (leftoverText && !leftoverText.startsWith("<")) {
      this.pendingText += leftoverText;
    }

    if (
      this.pendingText &&
      (!this.sawToolCall || this.emittedToolCall || this.pendingText.trim().length > 0)
    ) {
      this.flushPendingText(reasoningLogLabel);
    }

    if (this.reasoningContent && !this.reasoningFlushed) {
      this.reasoningFlushed = true;
      debugLog(reasoningLogLabel, {
        reasoning_length: this.reasoningContent.length,
        reasoning_preview: this.reasoningContent.slice(0, 300),
      });
    }

    if (!this.hasEmittedNormalOutput && !hasDeferredFallback) {
      const fallbackText = this.reasoningContent
        ? "The model completed internal reasoning but returned no visible response. Please retry. If this keeps happening, try a different model."
        : "The model returned no visible response. Please retry.";
      this.progress.report(new vscode.LanguageModelTextPart(fallbackText));
      this.hasEmittedOutput = true;
      this.hasEmittedNormalOutput = true;
    }
  }
}

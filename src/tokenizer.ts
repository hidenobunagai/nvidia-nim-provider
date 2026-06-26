import * as vscode from "vscode";
import { getDataPartTextValue, getTextPartValue, type LegacyPart } from "./message-parts";

/** Release all cached encodings. Safe to call during extension deactivation. */
export function disposeTokenizerCache(): void {
  // no-op: lightweight fallback tokenizer has no native/WASM cache
}

export function preloadTiktoken(): void {
  // no-op: kept for backward compatibility with existing call sites
}

export function estimateTokens(text: string, _modelId?: string): number {
  if (!text) return 0;
  const cjkPattern =
    /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/g;
  const cjkMatches = text.match(cjkPattern);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = text.length - cjkCount;
  // CJK: ~1.5 chars/token → use 1.2 for conservative overestimate
  // Latin/digits/symbols: ~4 chars/token → use 3 for conservative overestimate
  // This improves context utilization while still keeping a safety margin.
  return Math.ceil(cjkCount / 1.2 + otherCount / 3);
}

export function estimateMessagesTokens(
  messages: readonly { content: (vscode.LanguageModelInputPart | LegacyPart)[] }[],
  modelId?: string,
): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.content) {
      const textValue = getTextPartValue(part) ?? getDataPartTextValue(part);
      if (textValue !== undefined) {
        total += estimateTokens(textValue, modelId);
      }
    }
  }
  return total;
}

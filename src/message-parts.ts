import * as vscode from "vscode";
import { debugLog } from "./output-channel";

export interface LegacyPart {
  type?: string;
  mimeType?: string;
  bytes?: Uint8Array | number[];
  data?: Uint8Array | number[];
  buffer?: ArrayBuffer;
  value?: string;
  callId?: string;
  name?: string;
  input?: unknown;
  content?: unknown[];
  [key: string]: unknown;
}

function toUint8Array(
  data: Uint8Array | number[] | ArrayBuffer | string | undefined,
  options?: { allowBase64String?: boolean },
): Uint8Array | undefined {
  if (data instanceof Uint8Array && data.length > 0) {
    return data;
  }
  if (Array.isArray(data) && data.length > 0) {
    return new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer && data.byteLength > 0) {
    return new Uint8Array(data);
  }
  if (typeof data === "string" && data.length > 0) {
    const trimmed = data.trim();
    if (
      options?.allowBase64String &&
      trimmed.length > 0 &&
      trimmed.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
    ) {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length > 0) {
        try {
          const text = new TextDecoder().decode(decoded);
          if (!text.includes("\uFFFD") && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
            return decoded;
          }
        } catch {
          // Fall back to treating the value as plain text.
        }
      }
    }
    return Buffer.from(data, "utf8");
  }
  return undefined;
}

function isIgnorableToolResultPart(part: vscode.LanguageModelInputPart | LegacyPart): boolean {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const mimeType = (part as { mimeType?: unknown }).mimeType;
  return typeof mimeType === "string" && mimeType.includes("cache_control");
}

/** Type guard: part has a string `value` property (text content). */
export function hasTextValue(
  part: vscode.LanguageModelInputPart | LegacyPart,
): part is { value: string } {
  if (part instanceof vscode.LanguageModelTextPart) return true;
  return (
    typeof part === "object" &&
    part !== null &&
    typeof (part as { value?: unknown }).value === "string"
  );
}

/** Type guard: part has `callId` (string) and `content` (array) — a tool result. */
export function isToolResultPart(
  part: vscode.LanguageModelInputPart | LegacyPart,
): part is { callId: string; content: unknown[] } {
  const candidate = part as { callId?: unknown; content?: unknown[] };
  return typeof candidate.callId === "string" && Array.isArray(candidate.content);
}

/** Type guard: part has `callId` (string) and `name` (string) — a tool call. */
export function isToolCallPart(
  part: vscode.LanguageModelInputPart | LegacyPart,
): part is { callId: string; name: string; input: unknown } {
  const candidate = part as { callId?: unknown; name?: unknown; input?: unknown };
  return typeof candidate.callId === "string" && typeof candidate.name === "string";
}

export function getTextPartValue(
  part: vscode.LanguageModelInputPart | LegacyPart,
): string | undefined {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }
  if (typeof part === "object" && part !== null) {
    const candidate = part as { value?: string };
    if (typeof candidate.value === "string") {
      return candidate.value;
    }
  }
  return undefined;
}

export function getDataPartTextValue(
  part: vscode.LanguageModelInputPart | LegacyPart,
): string | undefined {
  if (typeof part !== "object" || part === null) {
    return undefined;
  }
  const candidate = part as {
    mimeType?: unknown;
    data?: Uint8Array | number[] | string;
    bytes?: Uint8Array | number[] | string;
    buffer?: ArrayBuffer;
  };
  if (typeof candidate.mimeType !== "string") {
    return undefined;
  }
  const isTextMime =
    candidate.mimeType.startsWith("text/") ||
    candidate.mimeType === "application/json" ||
    candidate.mimeType.endsWith("+json");
  if (!isTextMime) {
    return undefined;
  }
  const allowBase64String =
    candidate.mimeType === "application/json" || candidate.mimeType.endsWith("+json");
  const bytes =
    toUint8Array(candidate.data, { allowBase64String }) ??
    toUint8Array(candidate.bytes, { allowBase64String }) ??
    toUint8Array(candidate.buffer);
  if (!bytes) {
    return undefined;
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export function extractImageData(
  part: vscode.LanguageModelInputPart | LegacyPart,
): { mimeType: string; data: Uint8Array } | undefined {
  if (typeof part !== "object" || part === null) return undefined;

  const candidate = part as LegacyPart;
  const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : undefined;
  if (!mimeType || !mimeType.startsWith("image/")) {
    return undefined;
  }

  if (candidate.data instanceof Uint8Array && candidate.data.length > 0) {
    return { mimeType, data: candidate.data };
  }
  if (candidate.bytes instanceof Uint8Array && candidate.bytes.length > 0) {
    return { mimeType, data: candidate.bytes };
  }
  if (candidate.buffer instanceof ArrayBuffer && candidate.buffer.byteLength > 0) {
    return { mimeType, data: new Uint8Array(candidate.buffer) };
  }
  if (Array.isArray(candidate.bytes) && candidate.bytes.length > 0) {
    return { mimeType, data: new Uint8Array(candidate.bytes) };
  }
  if (Array.isArray(candidate.data) && candidate.data.length > 0) {
    return { mimeType, data: new Uint8Array(candidate.data) };
  }

  return undefined;
}

export function getToolCallInfo(
  part: vscode.LanguageModelInputPart | LegacyPart,
): { id?: string; name?: string; args?: Record<string, unknown> } | undefined {
  const candidate = part as { callId?: string; name?: string; input?: Record<string, unknown> };
  if (typeof candidate.callId === "string" && typeof candidate.name === "string") {
    return { id: candidate.callId, name: candidate.name, args: candidate.input };
  }
  return undefined;
}

export function getToolResultTexts(part: vscode.LanguageModelInputPart | LegacyPart): string[] {
  const results: string[] = [];
  const candidate = part as { callId?: string; content?: unknown[] };
  if (typeof candidate.callId === "string" && Array.isArray(candidate.content)) {
    for (const inner of candidate.content) {
      if (isIgnorableToolResultPart(inner as vscode.LanguageModelInputPart | LegacyPart)) {
        continue;
      }
      if (typeof inner === "object" && inner !== null && "value" in inner) {
        const value = (inner as { value?: unknown }).value;
        if (typeof value === "string") {
          results.push(value);
          continue;
        }
        if (value !== undefined) {
          try {
            results.push(JSON.stringify(value));
          } catch {
            results.push(String(value));
          }
          continue;
        }
      }
      const textValue =
        getTextPartValue(inner as vscode.LanguageModelInputPart | LegacyPart) ??
        getDataPartTextValue(inner as vscode.LanguageModelInputPart | LegacyPart);
      if (textValue !== undefined) {
        results.push(textValue);
        continue;
      }
      debugLog("Unhandled tool result part", inner);
      try {
        results.push(JSON.stringify(inner));
      } catch {
        results.push(String(inner));
      }
    }
  }
  return results;
}

export function getToolResultEntries(
  parts: Array<vscode.LanguageModelInputPart | LegacyPart>,
): Array<{ callId: string; content: string }> {
  const entries: Array<{ callId: string; content: string }> = [];
  for (const part of parts) {
    const candidate = part as { callId?: string; content?: unknown[] };
    if (typeof candidate.callId === "string" && Array.isArray(candidate.content)) {
      entries.push({
        callId: candidate.callId,
        content: getToolResultTexts(part).join("\n").trim(),
      });
    }
  }
  return entries;
}

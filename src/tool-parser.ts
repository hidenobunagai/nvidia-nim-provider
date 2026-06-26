import * as vscode from "vscode";

function safeJsonParse(text: string): unknown {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value;
    }
  } catch {
    // ignore
  }
  throw new Error("Failed to parse JSON");
}

export interface ParsedTextToolCall {
  name: string;
  args: unknown;
}

export interface ParsedTextSegmentText {
  type: "text";
  text: string;
}

export interface ParsedTextSegmentToolCall {
  type: "toolCall";
  toolCall: ParsedTextToolCall;
}

export interface ParsedTextSegmentInvalidToolCall {
  type: "invalidToolCall";
  name: string;
}

export type ParsedTextSegment =
  | ParsedTextSegmentText
  | ParsedTextSegmentToolCall
  | ParsedTextSegmentInvalidToolCall;

export interface ParsedTextToolCallResult {
  segments: ParsedTextSegment[];
  incompleteText: string;
}

export interface ParsedXmlStyleToolCallResult {
  consumed: number;
  incomplete: boolean;
  rawText?: string;
  toolCall?: ParsedTextToolCall;
}

export function findTrailingTokenPrefixStart(text: string, token: string): number {
  const maxPrefixLength = Math.min(text.length, token.length - 1);
  for (let prefixLength = maxPrefixLength; prefixLength > 0; prefixLength -= 1) {
    if (text.endsWith(token.slice(0, prefixLength))) {
      return text.length - prefixLength;
    }
  }
  return -1;
}

export function findTrailingTokenPrefixStartAny(text: string, tokens: readonly string[]): number {
  let bestMatch = -1;
  for (const token of tokens) {
    const matchIndex = findTrailingTokenPrefixStart(text, token);
    if (matchIndex !== -1 && (bestMatch === -1 || matchIndex < bestMatch)) {
      bestMatch = matchIndex;
    }
  }
  return bestMatch;
}

function parseEmbeddedToolParameterValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (
    /^[\[{\"]/.test(trimmed) ||
    /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  return trimmed;
}

export function parseXmlStyleToolCall(text: string): ParsedXmlStyleToolCallResult {
  const toolCallsStartToken = "<tool_calls>";
  const toolCallStartToken = "<tool_call ";
  const toolCallEndToken = "</tool_call>";
  const toolCallsEndPattern = /^\s*<\/tool_calls>/;

  let cursor = 0;
  let wrapped = false;

  if (text.startsWith(toolCallsStartToken)) {
    wrapped = true;
    cursor = toolCallsStartToken.length;
    while (cursor < text.length && /\s/.test(text[cursor])) {
      cursor += 1;
    }
  }

  if (!text.startsWith(toolCallStartToken, cursor)) {
    return { consumed: 0, incomplete: true };
  }

  const openTagEnd = text.indexOf(">", cursor);
  if (openTagEnd === -1) {
    return { consumed: 0, incomplete: true };
  }

  const openTag = text.slice(cursor, openTagEnd + 1);
  const closeTagIndex = text.indexOf(toolCallEndToken, openTagEnd + 1);
  if (closeTagIndex === -1) {
    return { consumed: 0, incomplete: true };
  }

  let consumed = closeTagIndex + toolCallEndToken.length;
  if (wrapped) {
    const wrapperCloseMatch = text.slice(consumed).match(toolCallsEndPattern);
    if (!wrapperCloseMatch) {
      return { consumed: 0, incomplete: true };
    }
    consumed += wrapperCloseMatch[0].length;
  }

  const toolName = openTag.match(/\bname\s*=\s*"([^"]+)"/)?.[1]?.trim();
  if (!toolName) {
    return { consumed, incomplete: false, rawText: text.slice(0, consumed) };
  }

  const innerContent = text.slice(openTagEnd + 1, closeTagIndex);
  const args: Record<string, unknown> = {};
  const parameterPattern = /<tool_parameter\s+name="([^"]+)">([\s\S]*?)<\/tool_parameter>/g;
  let parameterMatch: RegExpExecArray | null;
  while ((parameterMatch = parameterPattern.exec(innerContent)) !== null) {
    const parameterName = parameterMatch[1]?.trim();
    if (!parameterName) continue;
    args[parameterName] = parseEmbeddedToolParameterValue(parameterMatch[2] ?? "");
  }

  return { consumed, incomplete: false, toolCall: { name: toolName, args } };
}

export function unwrapJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

export function stripKnownControlText(text: string): string {
  return text.replace(/<｜DSML｜[^\s<]*/g, "").replace(/<\|DSML\|>[^\s<]*/g, "");
}

export function findControlTextTerminatorIndex(text: string): number {
  const terminatorMatch = text.match(/[\s<]/);
  return terminatorMatch?.index ?? -1;
}

export function parseDeepSeekTextEmbeddedToolCallContent(
  content: string,
): { name: string; argsText: string } | undefined {
  const separatorToken = "<｜tool▁sep｜>";
  const separatorIndex = content.indexOf(separatorToken);
  if (separatorIndex === -1) {
    return undefined;
  }

  const afterSeparator = content.slice(separatorIndex + separatorToken.length).trim();
  if (!afterSeparator) {
    return undefined;
  }

  const newlineIndex = afterSeparator.indexOf("\n");
  const name =
    newlineIndex === -1 ? afterSeparator.trim() : afterSeparator.slice(0, newlineIndex).trim();
  const argsText =
    newlineIndex === -1 ? "" : unwrapJsonCodeFence(afterSeparator.slice(newlineIndex).trim());

  if (!name) {
    return undefined;
  }

  return {
    name,
    argsText,
  };
}

export function parseTextEmbeddedToolCalls(text: string): ParsedTextToolCallResult {
  const beginToken = "<|tool_call_begin|>";
  const argBeginToken = "<|tool_call_argument_begin|>";
  const endToken = "<|tool_call_end|>";
  const deepSeekCallsBeginToken = "<｜tool▁calls▁begin｜>";
  const deepSeekCallBeginToken = "<｜tool▁call▁begin｜>";
  const deepSeekCallEndToken = "<｜tool▁call▁end｜>";
  const deepSeekCallsEndToken = "<｜tool▁calls▁end｜>";
  const unicodeDsmlToken = "<｜DSML｜";
  const asciiDsmlToken = "<|DSML|>";
  const partialTokens = [
    beginToken,
    deepSeekCallsBeginToken,
    deepSeekCallBeginToken,
    deepSeekCallsEndToken,
    unicodeDsmlToken,
    asciiDsmlToken,
  ] as const;

  const xmlStartTokens = ["<tool_calls>", "<tool_call "] as const;

  const segments: ParsedTextSegment[] = [];
  let remaining = text;
  let incompleteText = "";

  const appendText = (value: string): void => {
    const sanitizedValue = stripKnownControlText(value);
    if (!sanitizedValue) {
      return;
    }
    const lastSegment = segments.at(-1);
    if (lastSegment?.type === "text") {
      lastSegment.text += sanitizedValue;
      return;
    }
    segments.push({ type: "text", text: sanitizedValue });
  };

  while (remaining.length > 0) {
    const tokenMatches = [
      { kind: "openai" as const, token: beginToken, index: remaining.indexOf(beginToken) },
      {
        kind: "strip" as const,
        token: deepSeekCallsBeginToken,
        index: remaining.indexOf(deepSeekCallsBeginToken),
      },
      {
        kind: "deepseek" as const,
        token: deepSeekCallBeginToken,
        index: remaining.indexOf(deepSeekCallBeginToken),
      },
      {
        kind: "strip" as const,
        token: deepSeekCallsEndToken,
        index: remaining.indexOf(deepSeekCallsEndToken),
      },
      {
        kind: "control" as const,
        token: unicodeDsmlToken,
        index: remaining.indexOf(unicodeDsmlToken),
      },
      {
        kind: "control" as const,
        token: asciiDsmlToken,
        index: remaining.indexOf(asciiDsmlToken),
      },
      ...xmlStartTokens.map((token) => ({
        kind: "xml" as const,
        token,
        index: remaining.indexOf(token),
      })),
    ].filter((match) => match.index !== -1);

    tokenMatches.sort((left, right) => left.index - right.index);
    const nextTokenMatch = tokenMatches[0];

    if (!nextTokenMatch) {
      const partialBeginIndex = findTrailingTokenPrefixStartAny(remaining, [
        ...partialTokens,
        ...xmlStartTokens,
      ]);
      if (partialBeginIndex === -1) {
        appendText(remaining);
      } else {
        appendText(remaining.slice(0, partialBeginIndex));
        incompleteText = remaining.slice(partialBeginIndex);
      }
      break;
    }

    appendText(remaining.slice(0, nextTokenMatch.index));
    remaining = remaining.slice(nextTokenMatch.index + nextTokenMatch.token.length);

    if (nextTokenMatch.kind === "strip") {
      continue;
    }

    if (nextTokenMatch.kind === "xml") {
      // Re-prepend token length because parseXmlStyleToolCall expects to scan it
      const xmlToolCall = parseXmlStyleToolCall(nextTokenMatch.token + remaining);
      if (xmlToolCall.incomplete) {
        incompleteText = nextTokenMatch.token + remaining;
        break;
      }
      remaining = remaining.slice(xmlToolCall.consumed - nextTokenMatch.token.length);
      if (xmlToolCall.rawText) {
        appendText(xmlToolCall.rawText);
      } else if (xmlToolCall.toolCall) {
        segments.push({ type: "toolCall", toolCall: xmlToolCall.toolCall });
      }
      continue;
    }

    if (nextTokenMatch.kind === "control") {
      const terminatorIndex = findControlTextTerminatorIndex(remaining);
      if (terminatorIndex === -1) {
        incompleteText = nextTokenMatch.token + remaining;
        break;
      }

      remaining = remaining.slice(terminatorIndex);
      continue;
    }

    if (nextTokenMatch.kind === "deepseek") {
      const endIndex = remaining.indexOf(deepSeekCallEndToken);
      if (endIndex === -1) {
        incompleteText = nextTokenMatch.token + remaining;
        break;
      }

      const callText = remaining.slice(0, endIndex);
      remaining = remaining.slice(endIndex + deepSeekCallEndToken.length);

      const parsedToolCallContent = parseDeepSeekTextEmbeddedToolCallContent(callText);

      if (parsedToolCallContent) {
        try {
          const parsedArgs = parsedToolCallContent.argsText
            ? JSON.parse(parsedToolCallContent.argsText)
            : {};
          segments.push({
            type: "toolCall",
            toolCall: { name: parsedToolCallContent.name, args: parsedArgs },
          });
          continue;
        } catch {
          segments.push({ type: "invalidToolCall", name: parsedToolCallContent.name });
          continue;
        }
      }

      appendText(`${nextTokenMatch.token}${callText}${deepSeekCallEndToken}`);
      continue;
    }

    const argBeginIndex = remaining.indexOf(argBeginToken);
    const endIndex = remaining.indexOf(endToken);
    if (argBeginIndex === -1 || endIndex === -1 || argBeginIndex > endIndex) {
      incompleteText = beginToken + remaining;
      break;
    }

    const name = remaining.slice(0, argBeginIndex).trim();
    const argsText = remaining.slice(argBeginIndex + argBeginToken.length, endIndex).trim();
    remaining = remaining.slice(endIndex + endToken.length);

    if (!name) {
      continue;
    }

    try {
      segments.push({
        type: "toolCall",
        toolCall: { name, args: safeJsonParse(argsText) },
      });
    } catch {
      segments.push({ type: "invalidToolCall", name });
    }
  }

  return { segments, incompleteText };
}

/**
 * Stateful scanner for streaming text-embedded tool calls.
 */
export class ToolCallScanner {
  buffer = "";

  feed(text: string): ParsedTextSegment[] {
    this.buffer += text;
    const { segments, incompleteText } = parseTextEmbeddedToolCalls(this.buffer);
    this.buffer = incompleteText;
    return segments;
  }

  flushText(): string {
    const text = this.buffer;
    this.buffer = "";
    return text;
  }
}

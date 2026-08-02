import * as vscode from "vscode";
import { hasTextValue, isToolCallPart, isToolResultPart } from "./message-parts";

export interface ToolSchema {
  required?: string[];
  enumValues?: Record<string, string[]>;
  propertyTypes?: Record<string, string>;
}

export interface ChatRequestContext {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  cwd?: string;
}

export function buildToolCallCanonicalKey(name: string, args: unknown): string {
  const normalizedArgs =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? JSON.stringify(args, Object.keys(args as Record<string, unknown>).sort())
      : JSON.stringify(args);
  return `${name.toLowerCase()}:${normalizedArgs}`;
}

export function getCompletedToolCallKeys(
  messages: readonly vscode.LanguageModelChatMessage[],
  requestContext: ChatRequestContext | undefined,
  toolSchemas: ReadonlyMap<string, ToolSchema>,
): Set<string> {
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== vscode.LanguageModelChatMessageRole.User) continue;
    const hasNonToolResultContent = message.content.some((part) => !isToolResultPart(part));
    if (hasNonToolResultContent) {
      startIndex = i + 1;
      break;
    }
  }

  const completedCallIds = new Set<string>();
  for (const message of messages.slice(startIndex)) {
    for (const part of message.content) {
      if (isToolResultPart(part)) {
        completedCallIds.add(part.callId);
      }
    }
  }

  const keys = new Set<string>();
  for (const message of messages.slice(startIndex)) {
    for (const part of message.content) {
      if (!isToolCallPart(part) || !completedCallIds.has(part.callId)) {
        continue;
      }
      const repairedArgs = repairToolArguments(
        part.name,
        part.input ?? {},
        requestContext,
        toolSchemas.get(part.name.toLowerCase()),
      );
      keys.add(buildToolCallCanonicalKey(part.name, repairedArgs));
    }
  }
  return keys;
}

export function getToolSchemaMap(
  options: vscode.ProvideLanguageModelChatResponseOptions,
): Map<string, ToolSchema> {
  const map = new Map<string, ToolSchema>();
  for (const tool of options.tools ?? []) {
    const inputSchema = tool.inputSchema as
      | { required?: unknown; properties?: unknown }
      | undefined;
    const required = Array.isArray(inputSchema?.required)
      ? inputSchema.required.filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        )
      : undefined;
    const enumValues: Record<string, string[]> = {};
    const propertyTypes: Record<string, string> = {};
    const properties =
      typeof inputSchema?.properties === "object" && inputSchema.properties !== null
        ? (inputSchema.properties as Record<string, unknown>)
        : {};
    for (const [name, value] of Object.entries(properties)) {
      const propSchema =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as { enum?: unknown; type?: unknown })
          : undefined;
      if (Array.isArray(propSchema?.enum)) {
        const allowed = propSchema.enum.filter((item): item is string => typeof item === "string");
        if (allowed.length > 0) {
          enumValues[name] = allowed;
        }
      }
      if (typeof propSchema?.type === "string") {
        propertyTypes[name] = propSchema.type;
      }
    }
    const key = tool.name.toLowerCase();
    map.set(key, { required, enumValues, propertyTypes });
  }
  return map;
}

export function hasRequiredToolArguments(args: unknown, schema: ToolSchema | undefined): boolean {
  return getMissingRequiredToolArguments(args, schema).length === 0;
}

export function getMissingRequiredToolArguments(
  args: unknown,
  schema: ToolSchema | undefined,
): string[] {
  const required = schema?.required ?? [];
  if (required.length === 0) return [];
  if (typeof args !== "object" || args === null || Array.isArray(args)) return [...required];
  const record = args as Record<string, unknown>;
  return required.filter(
    (key) =>
      !(key in record && record[key] !== undefined && record[key] !== null && record[key] !== ""),
  );
}

export function buildInvalidToolCallFallback(
  skippedToolCalls: readonly { name: string; required: string[]; missing: string[] }[],
): string | undefined {
  const skippedWithRequiredArgs = skippedToolCalls.find(
    (tc) => tc.missing.length > 0 || tc.required.length > 0,
  );
  if (
    skippedWithRequiredArgs &&
    (skippedWithRequiredArgs.missing.length > 0 || skippedWithRequiredArgs.required.length > 0)
  ) {
    const missingArgs = (
      skippedWithRequiredArgs.missing.length > 0
        ? skippedWithRequiredArgs.missing
        : skippedWithRequiredArgs.required
    )
      .map((a) => `\`${a}\``)
      .join(", ");
    return `Tool call \`${skippedWithRequiredArgs.name}\` was rejected: missing ${missingArgs}. Retry with all required fields filled.`;
  }

  const firstSkippedToolCall = skippedToolCalls[0];
  if (!firstSkippedToolCall) {
    return undefined;
  }

  return `Tool call \`${firstSkippedToolCall.name}\` had invalid arguments. Retry with a valid JSON object.`;
}

export function buildInvalidToolCallRetryMessage(
  skippedToolCalls: readonly { name: string; required: string[]; missing: string[] }[],
): string | undefined {
  const skippedWithRequiredArgs = skippedToolCalls.find(
    (tc) => tc.missing.length > 0 || tc.required.length > 0,
  );
  if (
    skippedWithRequiredArgs &&
    (skippedWithRequiredArgs.missing.length > 0 || skippedWithRequiredArgs.required.length > 0)
  ) {
    const requiredList = (
      skippedWithRequiredArgs.missing.length > 0
        ? skippedWithRequiredArgs.missing
        : skippedWithRequiredArgs.required
    ).join(", ");
    return [
      `Your previous tool call "${skippedWithRequiredArgs.name}" was rejected because it was missing required arguments: ${requiredList}.`,
      `Retry NOW. Provide a valid JSON object containing ALL of: ${requiredList}.`,
      "Do not call any tool with an empty object or missing fields.",
      "Do not ask the user to retry. Do not explain the error.",
    ].join(" ");
  }

  const firstSkippedToolCall = skippedToolCalls[0];
  if (!firstSkippedToolCall) {
    return undefined;
  }

  return [
    `Your previous tool call "${firstSkippedToolCall.name}" was rejected due to invalid or incomplete arguments.`,
    "Retry NOW with a complete, valid JSON object.",
    "Do not emit malformed JSON or empty arguments.",
    "Do not ask the user to retry. Do not explain what went wrong.",
  ].join(" ");
}

export function extractChatRequestContext(
  messages: readonly vscode.LanguageModelChatMessage[],
): ChatRequestContext | undefined {
  const filePattern = /The user's current file is\s+([^\n]+?)\.(?:\s|$)/;
  const selectionPattern = /The current selection is from line\s+(\d+)\s+to line\s+(\d+)/;
  const cwdPattern = /(?:^|\n)Cwd:\s+([^\n]+)/;
  const context: ChatRequestContext = {};

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    for (const part of message.content) {
      const text =
        part instanceof vscode.LanguageModelTextPart
          ? part.value
          : hasTextValue(part)
            ? part.value
            : undefined;
      if (!text) continue;

      const fileMatch = text.match(filePattern);
      const selectionMatch = text.match(selectionPattern);
      const cwdMatch = text.match(cwdPattern);

      if (fileMatch && !context.filePath) context.filePath = fileMatch[1].trim();
      if (cwdMatch && !context.cwd) context.cwd = cwdMatch[1].trim();
      if (selectionMatch && context.startLine === undefined && context.endLine === undefined) {
        const startLine = Number(selectionMatch[1]);
        const endLine = Number(selectionMatch[2]);
        if (Number.isFinite(startLine) && Number.isFinite(endLine)) {
          context.startLine = startLine;
          context.endLine = endLine;
        }
      }
      if (
        context.filePath &&
        context.cwd &&
        context.startLine !== undefined &&
        context.endLine !== undefined
      )
        break;
    }
  }

  return context.filePath ||
    context.cwd ||
    context.startLine !== undefined ||
    context.endLine !== undefined
    ? context
    : undefined;
}

export function repairToolArguments(
  toolName: string,
  args: unknown,
  requestContext: ChatRequestContext | undefined,
  schema?: ToolSchema,
): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return args;

  const record = args as Record<string, unknown>;
  const required = new Set(schema?.required ?? []);
  const propertyTypes = schema?.propertyTypes ?? {};
  const needsStringField = (value: unknown, field: string): boolean =>
    required.has(field) && (typeof value !== "string" || value.trim().length === 0);
  const needsNumberField = (value: unknown, field: string): boolean =>
    required.has(field) && typeof value !== "number";
  const needsBooleanField = (value: unknown, field: string): boolean =>
    required.has(field) && typeof value !== "boolean";

  const coerceValue = (value: unknown, field: string): unknown => {
    if (typeof value !== "string") return value;
    const expectedType = propertyTypes[field];
    if (!expectedType) return value;
    if (expectedType === "number" || expectedType === "integer") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (expectedType === "boolean") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
    return value;
  };

  const repaired: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    repaired[key] = coerceValue(value, key);
  }

  if (needsBooleanField(repaired.isRegexp, "isRegexp")) repaired.isRegexp = false;
  if (needsBooleanField(repaired.includeIgnoredFiles, "includeIgnoredFiles"))
    repaired.includeIgnoredFiles = false;

  if (toolName.toLowerCase() === "run_in_terminal") {
    if (needsStringField(repaired.command, "command")) {
      return repaired;
    }
    return {
      ...repaired,
      ...(needsStringField(repaired.explanation, "explanation")
        ? { explanation: "Run command in terminal" }
        : {}),
      ...(needsStringField(repaired.goal, "goal") ? { goal: "Execute command" } : {}),
      ...(needsStringField(repaired.mode, "mode") ? { mode: "sync" } : {}),
      ...(needsNumberField(repaired.timeout, "timeout") ? { timeout: 30000 } : {}),
    };
  }

  if (!requestContext) return repaired;

  if (toolName.toLowerCase() === "read_file") {
    const inferredFilePath =
      requestContext?.filePath ??
      vscode.window.activeTextEditor?.document.uri.fsPath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return {
      ...repaired,
      ...(needsStringField(repaired.filePath, "filePath") && inferredFilePath
        ? { filePath: inferredFilePath }
        : {}),
      ...(needsNumberField(repaired.startLine, "startLine")
        ? { startLine: requestContext.startLine ?? 1 }
        : {}),
      ...(needsNumberField(repaired.endLine, "endLine")
        ? { endLine: requestContext.endLine ?? 200 }
        : {}),
    };
  }

  if (toolName.toLowerCase() === "list_dir") {
    return {
      ...repaired,
      ...(needsStringField(repaired.path, "path") && requestContext.cwd
        ? { path: requestContext.cwd }
        : {}),
    };
  }

  return repaired;
}

export function isToolCallInput(args: unknown): args is Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args);
}

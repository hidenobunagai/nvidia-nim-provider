import * as vscode from "vscode";
import { DEBUG_ENV_VAR, PROVIDER_DISPLAY_NAME } from "./constants";

const OUTPUT_CHANNEL_NAME = PROVIDER_DISPLAY_NAME;
const DEBUG_LOG_PREFIX = `[${PROVIDER_DISPLAY_NAME} Debug]`;
const LOG_PREFIX = `[${PROVIDER_DISPLAY_NAME}]`;
const ERROR_LOG_PREFIX = `[${PROVIDER_DISPLAY_NAME} Error]`;
const WARN_LOG_PREFIX = `[${PROVIDER_DISPLAY_NAME} Warning]`;
const CAPTURE_LOG_PREFIX = `[${PROVIDER_DISPLAY_NAME} Capture]`;

/** Module-private output channel. Lazily created on first access. */
let _channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return _channel;
}

/** Dispose the output channel and reset state. Safe to call during deactivation. */
export function disposeOutputChannel(): void {
  if (_channel) {
    _channel.dispose();
    _channel = undefined;
  }
}

export function debugEnabled(): boolean {
  return process.env[DEBUG_ENV_VAR] === "1";
}

function appendChannelLine(prefix: string, label: string, value: unknown, ensureChannel = false) {
  const message = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const channel = ensureChannel ? getOutputChannel() : _channel;
  if (channel) {
    channel.appendLine(`${prefix} ${label}: ${message}`);
    return;
  }
  console.log(`${prefix} ${label}:`, value);
}

export function debugLog(label: string, value: unknown): void {
  if (!debugEnabled()) {
    return;
  }
  appendChannelLine(DEBUG_LOG_PREFIX, label, value);
}

export function captureLog(label: string, value: unknown): void {
  appendChannelLine(CAPTURE_LOG_PREFIX, label, value, true);
}

export function outputLog(label: string, value: unknown): void {
  appendChannelLine(LOG_PREFIX, label, value);
}

export function errorLog(label: string, value: unknown): void {
  appendChannelLine(ERROR_LOG_PREFIX, label, value);
}

export function warnLog(label: string, value: unknown): void {
  appendChannelLine(WARN_LOG_PREFIX, label, value);
}

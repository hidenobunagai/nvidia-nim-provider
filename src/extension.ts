import * as vscode from "vscode";
import { fetchModels } from "./api";
import {
  DEBUG_ENV_VAR,
  DEBUG_STATE_KEY,
  EXTENSION_VERSION,
  MANAGE_COMMAND_ID,
  MIGRATION_DONE_KEY,
  MODELS_CACHE_VERSION,
  MODELS_CACHE_VERSION_STATE_KEY,
  MODELS_STATE_KEY,
  OPEN_DEBUG_LOG_COMMAND_ID,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_VENDOR,
  RAW_MODELS_STATE_KEY,
  REFRESH_MODELS_COMMAND_ID,
  SECRET_STORAGE_KEY,
  TOGGLE_DEBUG_LOGGING_COMMAND_ID,
  TOGGLE_SHOW_REASONING_COMMAND_ID,
} from "./constants";
import { normalizeNvidiaModels } from "./model-catalog";
import { debugLog, disposeOutputChannel, getOutputChannel, outputLog } from "./output-channel";
import { NvidiaNimChatModelProvider } from "./provider";
import { StatusBarManager } from "./status-bar";
import { registerNvidiaNimTools } from "./tools";

let _provider: NvidiaNimChatModelProvider | null = null;
let _refreshQueue: Promise<void> = Promise.resolve();

async function migrateLanguageModelProviderGroup(apiKey: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand("lm.migrateLanguageModelsProviderGroup", {
      vendor: PROVIDER_VENDOR,
      name: PROVIDER_DISPLAY_NAME,
      apiKey,
    });
    outputLog(
      "languageModelGroup",
      `Configured ${PROVIDER_DISPLAY_NAME} language model group from stored API key.`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputLog(
      "languageModelGroup",
      `Could not configure VS Code language model group automatically: ${message}`,
    );
    return /already exists/i.test(message);
  }
}

async function initializeStoredApiKey(context: vscode.ExtensionContext, ua: string): Promise<void> {
  const apiKey = await context.secrets.get(SECRET_STORAGE_KEY);
  if (!apiKey) {
    return;
  }

  const migrationDone = context.globalState.get<boolean>(MIGRATION_DONE_KEY, false);
  if (!migrationDone && (await migrateLanguageModelProviderGroup(apiKey))) {
    await context.globalState.update(MIGRATION_DONE_KEY, true);
  }
  await refreshModelsFromApi(context, ua, { showMessages: false, apiKey });
}

async function refreshModelsFromApi(
  context: vscode.ExtensionContext,
  ua: string,
  options: { showMessages: boolean; apiKey?: string },
): Promise<void> {
  const nextRefresh = _refreshQueue
    .catch(() => undefined)
    .then(async () => {
      const apiKey = options.apiKey ?? (await context.secrets.get(SECRET_STORAGE_KEY));
      if (!apiKey) {
        if (options.showMessages) {
          vscode.window.showWarningMessage(`No ${PROVIDER_DISPLAY_NAME} API key configured.`);
        }
        return;
      }

      try {
        const rawModels = await fetchModels(apiKey, undefined, ua);
        if (Array.isArray(rawModels)) {
          const normalizedModels = normalizeNvidiaModels(rawModels);
          const previousRawModels = context.globalState.get(RAW_MODELS_STATE_KEY);
          await context.globalState.update(RAW_MODELS_STATE_KEY, rawModels);
          try {
            await context.globalState.update(MODELS_STATE_KEY, normalizedModels);
          } catch (normalizedWriteError) {
            try {
              await context.globalState.update(RAW_MODELS_STATE_KEY, previousRawModels);
            } catch (rollbackError) {
              debugLog(
                "refreshModels",
                `Raw cache rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              );
            }
            throw normalizedWriteError;
          }
          await context.globalState.update(MODELS_CACHE_VERSION_STATE_KEY, MODELS_CACHE_VERSION);
          _provider?.fireModelInfoChanged();
          debugLog(
            "refreshModels",
            `Refreshed ${normalizedModels.length} models from ${PROVIDER_DISPLAY_NAME} API.`,
          );
          if (options.showMessages) {
            vscode.window.showInformationMessage(
              `Refreshed ${normalizedModels.length} ${PROVIDER_DISPLAY_NAME} models.`,
            );
          }
          return;
        }

        debugLog("refreshModels", "Model refresh failed or returned malformed data.");
        if (options.showMessages) {
          vscode.window.showWarningMessage(
            `Failed to refresh models from ${PROVIDER_DISPLAY_NAME} API.`,
          );
        }
      } catch (error) {
        debugLog(
          "refreshModels",
          `Model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (options.showMessages) {
          vscode.window.showErrorMessage(
            `Failed to refresh models: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    });

  _refreshQueue = nextRefresh.catch(() => undefined);
  return nextRefresh;
}

export function activate(context: vscode.ExtensionContext) {
  const ua = `nvidia-nim-provider/${EXTENSION_VERSION} VSCode/${vscode.version}`;
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);
  const debugEnabled = context.globalState.get<boolean>(DEBUG_STATE_KEY, false);
  process.env[DEBUG_ENV_VAR] = debugEnabled ? "1" : "0";
  debugLog(
    "activate",
    `Extension activated. Debug logging ${debugEnabled ? "enabled" : "disabled"}.`,
  );
  const provider = new NvidiaNimChatModelProvider(context.secrets, ua, context.globalState);
  _provider = provider;

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === SECRET_STORAGE_KEY) {
        _provider?.fireModelInfoChanged();
      }
    }),
  );

  const registration = vscode.lm.registerLanguageModelChatProvider(PROVIDER_VENDOR, provider);
  context.subscriptions.push(registration);
  context.subscriptions.push(registerNvidiaNimTools(context.secrets, context.globalState));
  context.subscriptions.push(
    vscode.commands.registerCommand(MANAGE_COMMAND_ID, async () => {
      const existing = await context.secrets.get(SECRET_STORAGE_KEY);
      const apiKey = await vscode.window.showInputBox({
        title: `${PROVIDER_DISPLAY_NAME} API Key`,
        prompt: existing
          ? `Update your ${PROVIDER_DISPLAY_NAME} API key`
          : `Enter your ${PROVIDER_DISPLAY_NAME} API key`,
        ignoreFocusOut: true,
        password: true,
        value: existing ?? "",
        placeHolder: `Enter your ${PROVIDER_DISPLAY_NAME} API key...`,
      });
      if (apiKey === undefined) {
        return;
      }
      if (!apiKey.trim()) {
        await context.secrets.delete(SECRET_STORAGE_KEY);
        vscode.window.showInformationMessage(
          `${PROVIDER_DISPLAY_NAME} legacy API key cleared. If ${PROVIDER_DISPLAY_NAME} still appears in Copilot Chat, remove its model group from Manage Models.`,
        );
        _provider?.fireModelInfoChanged();
        return;
      }
      await context.secrets.store(SECRET_STORAGE_KEY, apiKey.trim());
      if (await migrateLanguageModelProviderGroup(apiKey.trim())) {
        await context.globalState.update(MIGRATION_DONE_KEY, true);
      }
      vscode.window.showInformationMessage(`${PROVIDER_DISPLAY_NAME} API key saved.`);
      _provider?.fireModelInfoChanged();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(REFRESH_MODELS_COMMAND_ID, async () => {
      await refreshModelsFromApi(context, ua, { showMessages: true });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TOGGLE_DEBUG_LOGGING_COMMAND_ID, async () => {
      const current = context.globalState.get<boolean>(DEBUG_STATE_KEY, false);
      const next = !current;
      await context.globalState.update(DEBUG_STATE_KEY, next);
      process.env[DEBUG_ENV_VAR] = next ? "1" : "0";
      debugLog("toggleDebug", `Debug logging ${next ? "enabled" : "disabled"}.`);
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} debug logging ${next ? "enabled" : "disabled"}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_DEBUG_LOG_COMMAND_ID, () => {
      const output = getOutputChannel();
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(TOGGLE_SHOW_REASONING_COMMAND_ID, async () => {
      const config = vscode.workspace.getConfiguration("nvidia-nim");
      const current = config.get<boolean>("showReasoning", false);
      await config.update("showReasoning", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `NVIDIA NIM reasoning content display ${!current ? "enabled" : "disabled"}.`,
      );
    }),
  );

  void initializeStoredApiKey(context, ua);
}

export function deactivate() {
  _provider = null;
  _refreshQueue = Promise.resolve();
  disposeOutputChannel();
}

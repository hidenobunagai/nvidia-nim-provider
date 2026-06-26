import * as vscode from "vscode";
import {
  CancellationToken,
  Event,
  EventEmitter,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  PrepareLanguageModelChatModelOptions,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from "vscode";
import { fetchModels } from "./api";
import {
  CONTEXT_WINDOW_SAFETY_MARGIN,
  DEBUG_ENV_VAR,
  MANAGE_COMMAND_ID,
  MODELS_CACHE_VERSION,
  MODELS_CACHE_VERSION_STATE_KEY,
  MODELS_STATE_KEY,
  PROVIDER_DISPLAY_NAME,
  PROVIDER_VENDOR,
  SECRET_STORAGE_KEY,
} from "./constants";
import {
  isNormalizedNvidiaModel,
  NormalizedNvidiaModel,
  normalizeNvidiaModels,
} from "./model-catalog";
import { getModelAdapter } from "./adapters";
import { NvidiaNimMcpClient } from "./mcp";
import { debugLog, outputLog } from "./output-channel";
import { estimateMessagesTokens, estimateTokens } from "./tokenizer";
import { processOpenAIStream } from "./streaming/openai";
import { LegacyPart } from "./message-parts";

const DEFAULT_MAX_TOKENS = 65536;

interface StructuredError {
  code: string;
  cause: string;
  action: string;
}

const ERROR_MESSAGES: Record<string, StructuredError> = {
  auth_failed: {
    code: "AUTH_FAILED",
    cause: "API key is invalid or expired.",
    action: "Update your API key via Command Palette > NVIDIA NIM: Manage API Key.",
  },
  rate_limited: {
    code: "RATE_LIMITED",
    cause: "Too many requests to NVIDIA NIM API.",
    action: "Wait a moment and try again. Consider switching to a different model.",
  },
  server_error: {
    code: "SERVER_ERROR",
    cause: "NVIDIA NIM service is experiencing issues.",
    action: "Wait a few minutes and try again.",
  },
  timeout: {
    code: "STREAM_TIMEOUT",
    cause: "The model took too long to respond.",
    action: "Try again with a shorter prompt or switch to a faster model.",
  },
  token_limit: {
    code: "TOKEN_LIMIT_EXCEEDED",
    cause: "The conversation is too long for this model's context window.",
    action: "Start a new chat or switch to a model with a larger context window.",
  },
};

function formatStructuredError(key: string, detail?: string): string {
  const err = ERROR_MESSAGES[key];
  if (!err) return detail ?? "An unknown error occurred.";
  return [`[${err.code}] ${err.cause}`, detail ? `Details: ${detail}` : "", `Action: ${err.action}`]
    .filter(Boolean)
    .join("\n");
}

interface NvidiaProviderConfiguration {
  apiKey?: string;
}

interface NvidiaLanguageModelChatInformation extends LanguageModelChatInformation {
  apiKey?: string;
  isUserSelectable?: boolean;
}

type SelectedModelRuntimeCapabilities = LanguageModelChatInformation & {
  capabilities?: {
    toolCalling?: unknown;
    imageInput?: unknown;
  };
};

type ChatRuntimeMetadataSource = "cache" | "selected-model" | "fetched-model";

function getApiKeyFromConfiguration(
  options: PrepareLanguageModelChatModelOptions,
): string | undefined {
  const configuration = (options as { configuration?: NvidiaProviderConfiguration }).configuration;
  return getNonEmptyApiKey(configuration?.apiKey);
}

function getApiKeyFromModel(model: LanguageModelChatInformation): string | undefined {
  return getNonEmptyApiKey((model as NvidiaLanguageModelChatInformation).apiKey);
}

function getProviderGroupName(options: PrepareLanguageModelChatModelOptions): string | undefined {
  const group = (options as { group?: unknown }).group;
  if (typeof group === "string" && group.trim().length > 0) {
    return group.trim();
  }
  if (typeof group === "object" && group !== null) {
    const name = (group as { name?: unknown }).name;
    return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
  }
  return undefined;
}

function hasProviderGroupConfiguration(options: PrepareLanguageModelChatModelOptions): boolean {
  const configuration = (options as { configuration?: unknown }).configuration;
  return typeof configuration === "object" && configuration !== null;
}

function getNonEmptyApiKey(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildMissingApiKeyFallback(): string {
  return `${PROVIDER_DISPLAY_NAME} API key is not configured. Run "${PROVIDER_DISPLAY_NAME}: Manage ${PROVIDER_DISPLAY_NAME} API Key" from the Command Palette, or retry this request and enter the key when prompted.`;
}

export class NvidiaNimChatModelProvider implements LanguageModelChatProvider {
  private readonly mcpClient: NvidiaNimMcpClient;
  private readonly runtimeInfoCache = new Map<
    string,
    {
      supportsTools: boolean;
      supportsVision: boolean;
      contextWindow: number;
      runtimeMetadataSource: ChatRuntimeMetadataSource;
    }
  >();
  private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
  /** Cleared at the start of each VS Code resolution cycle (groupless call). */
  private readonly _selectableModelIdsInCycle = new Set<string>();
  private _infoCallCounter = 0;
  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
    private readonly globalState?: vscode.Memento,
  ) {
    this.mcpClient = new NvidiaNimMcpClient(secrets, globalState);
  }

  fireModelInfoChanged(): void {
    this.runtimeInfoCache.clear();
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  private getConfiguredApiKeyState(configuration: unknown): {
    hasApiKeyProperty: boolean;
    apiKey?: string;
  } {
    if (!configuration || typeof configuration !== "object") {
      return { hasApiKeyProperty: false };
    }

    const configurationRecord = configuration as { apiKey?: unknown };
    if (!("apiKey" in configurationRecord)) {
      return { hasApiKeyProperty: false };
    }

    const apiKey = configurationRecord.apiKey;
    if (typeof apiKey !== "string") {
      return { hasApiKeyProperty: true };
    }

    const normalizedApiKey = apiKey.trim();
    return {
      hasApiKeyProperty: true,
      apiKey: normalizedApiKey || undefined,
    };
  }

  private async syncConfiguredApiKey(options: unknown): Promise<string | undefined> {
    if (!options || typeof options !== "object") {
      return undefined;
    }

    const optionsRecord = options as { configuration?: unknown; modelConfiguration?: unknown };
    const modelConfigurationState = this.getConfiguredApiKeyState(optionsRecord.modelConfiguration);
    const providerConfigurationState = this.getConfiguredApiKeyState(optionsRecord.configuration);
    const hasExplicitApiKeyProperty =
      modelConfigurationState.hasApiKeyProperty || providerConfigurationState.hasApiKeyProperty;
    if (!hasExplicitApiKeyProperty) {
      return undefined;
    }

    const configuredApiKey = modelConfigurationState.apiKey ?? providerConfigurationState.apiKey;
    const storedApiKey = await this.secrets.get(SECRET_STORAGE_KEY);
    if (!configuredApiKey) {
      if (storedApiKey !== undefined) {
        await this.secrets.delete(SECRET_STORAGE_KEY);
      }
      return undefined;
    }

    if (storedApiKey !== configuredApiKey) {
      await this.secrets.store(SECRET_STORAGE_KEY, configuredApiKey);
    }

    return configuredApiKey;
  }

  private modelSupportsVision(modelId: string): boolean {
    const cachedModel = this.getNormalizedModels().find((entry) => entry.id === modelId);
    return cachedModel?.supportsVision ?? false;
  }

  private getVisionFallbackModelId(): string | undefined {
    const cachedModels = this.getNormalizedModels();
    const visionModel = cachedModels.find((model) => model.supportsVision);
    return visionModel?.id;
  }

  private async processImagesForNonVisionModel(
    messages: readonly LanguageModelChatMessage[],
    token: CancellationToken,
    apiKey: string,
  ): Promise<LanguageModelChatMessage[]> {
    const processedMessages: LanguageModelChatMessage[] = [];

    for (const msg of messages) {
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (
          typeof part === "object" &&
          part !== null &&
          "value" in part &&
          typeof (part as { value?: unknown }).value === "string"
        ) {
          textParts.push((part as { value: string }).value);
        }
      }

      const images: Array<{ mimeType: string; data: Uint8Array }> = [];
      for (const part of msg.content) {
        const p = part as { mimeType?: unknown; data?: unknown; bytes?: unknown; buffer?: unknown };
        if (typeof p.mimeType !== "string" || !p.mimeType.startsWith("image/")) continue;
        let data: Uint8Array | undefined;
        if (p.data instanceof Uint8Array && p.data.length > 0) data = p.data;
        else if (p.bytes instanceof Uint8Array && (p.bytes as Uint8Array).length > 0)
          data = p.bytes as Uint8Array;
        else if (Array.isArray(p.data) && p.data.length > 0)
          data = new Uint8Array(p.data as number[]);
        else if (Array.isArray(p.bytes) && (p.bytes as unknown[]).length > 0)
          data = new Uint8Array(p.bytes as number[]);
        if (data) images.push({ mimeType: p.mimeType, data });
      }

      if (images.length === 0) {
        processedMessages.push(msg);
        continue;
      }

      const userPrompt = textParts.join(" ");
      const abortController = new AbortController();
      const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

      const descriptions = await Promise.all(
        images.map(async (img) => {
          if (token.isCancellationRequested) throw new vscode.CancellationError();
          const base64Data = Buffer.from(img.data).toString("base64");
          const imageDataUrl = `data:${img.mimeType};base64,${base64Data}`;
          const analysisPrompt = userPrompt || "Describe this image in detail.";
          return this.mcpClient.analyzeImage(
            imageDataUrl,
            analysisPrompt,
            abortController.signal,
            apiKey,
          );
        }),
      ).finally(() => cancellationSubscription.dispose());

      const newContent: vscode.LanguageModelTextPart[] = textParts.map(
        (t) => new vscode.LanguageModelTextPart(t),
      );
      if (descriptions.length > 0) {
        newContent.push(
          new vscode.LanguageModelTextPart(
            `\n\n[Image Analysis]:\n${descriptions.join("\n\n---\n\n")}`,
          ),
        );
      }
      processedMessages.push(vscode.LanguageModelChatMessage.User(newContent));
    }

    return processedMessages;
  }

  private getNormalizedModels(): NormalizedNvidiaModel[] {
    const storedModels = this.globalState?.get<unknown>(MODELS_STATE_KEY);
    if (!Array.isArray(storedModels)) {
      return [];
    }

    return storedModels.every(isNormalizedNvidiaModel) ? storedModels : [];
  }

  private async getAvailableModels(
    apiKey?: string,
    options: { refreshStaleCache?: boolean } = {},
  ): Promise<NormalizedNvidiaModel[]> {
    const cachedModels = this.getNormalizedModels();
    const cacheVersion = this.globalState?.get<number>(MODELS_CACHE_VERSION_STATE_KEY);
    if (
      cachedModels.length > 0 &&
      (cacheVersion === MODELS_CACHE_VERSION || !apiKey || !options.refreshStaleCache)
    ) {
      return cachedModels;
    }

    const refreshedModels = await this.fetchAvailableModels(apiKey);
    return refreshedModels ?? cachedModels;
  }

  private async fetchAvailableModels(
    configuredApiKey?: string,
  ): Promise<NormalizedNvidiaModel[] | undefined> {
    const apiKey = configuredApiKey ?? (await this.secrets.get(SECRET_STORAGE_KEY));
    if (!apiKey) {
      return undefined;
    }

    const rawModels = await fetchModels(apiKey, undefined, this.userAgent);
    if (!Array.isArray(rawModels)) {
      debugLog("modelPicker", "Unable to fetch models on demand.");
      return undefined;
    }

    const normalizedModels = normalizeNvidiaModels(rawModels);
    await this.globalState?.update(MODELS_STATE_KEY, normalizedModels);
    await this.globalState?.update(MODELS_CACHE_VERSION_STATE_KEY, MODELS_CACHE_VERSION);
    return normalizedModels;
  }

  private async resolveChatModelRuntimeInfo(
    model: LanguageModelChatInformation,
    apiKey?: string,
  ): Promise<{
    supportsTools: boolean;
    supportsVision: boolean;
    contextWindow: number;
    runtimeMetadataSource: ChatRuntimeMetadataSource;
  }> {
    const cachedRuntimeInfo = this.runtimeInfoCache.get(model.id);
    if (cachedRuntimeInfo) {
      return cachedRuntimeInfo;
    }

    const cachedModel = this.getNormalizedModels().find((entry) => entry.id === model.id);
    if (cachedModel) {
      const runtimeInfo = {
        supportsTools: cachedModel.supportsTools,
        supportsVision: cachedModel.supportsVision,
        contextWindow: cachedModel.contextWindow,
        runtimeMetadataSource: "cache" as const,
      };
      this.runtimeInfoCache.set(model.id, runtimeInfo);
      return runtimeInfo;
    }

    const capabilities = (model as SelectedModelRuntimeCapabilities).capabilities;
    if (capabilities) {
      const runtimeInfo = {
        supportsTools: Boolean(capabilities.toolCalling),
        supportsVision: capabilities.imageInput === true,
        contextWindow: model.maxInputTokens + Math.min(model.maxOutputTokens, DEFAULT_MAX_TOKENS),
        runtimeMetadataSource: "selected-model" as const,
      };
      this.runtimeInfoCache.set(model.id, runtimeInfo);
      return runtimeInfo;
    }

    const fetchedModel = (await this.getAvailableModels(apiKey)).find(
      (entry) => entry.id === model.id,
    );
    const runtimeInfo = {
      supportsTools: fetchedModel?.supportsTools ?? false,
      supportsVision: fetchedModel?.supportsVision ?? false,
      contextWindow:
        fetchedModel?.contextWindow ??
        model.maxInputTokens + Math.min(model.maxOutputTokens, DEFAULT_MAX_TOKENS),
      runtimeMetadataSource: "fetched-model" as const,
    };
    this.runtimeInfoCache.set(model.id, runtimeInfo);
    return runtimeInfo;
  }

  private calculateMaxToolResultChars(contextWindow: number): number {
    if (contextWindow >= 500000) {
      return 50000;
    }
    if (contextWindow >= 200000) {
      return 30000;
    }
    if (contextWindow >= 100000) {
      return 20000;
    }
    return 10000;
  }

  private calculateRequestedMaxTokens(options: {
    requestedMaxTokens: number;
    modelMaxOutputTokens: number;
    contextWindow: number;
    inputTokenCount: number;
  }): number {
    const availableCompletionTokens = Math.max(
      1,
      options.contextWindow - options.inputTokenCount - CONTEXT_WINDOW_SAFETY_MARGIN,
    );

    return Math.min(
      options.requestedMaxTokens,
      options.modelMaxOutputTokens,
      availableCompletionTokens,
    );
  }

  private hasImageInput(messages: readonly LanguageModelChatMessage[]): boolean {
    for (const msg of messages) {
      for (const part of msg.content) {
        const p = part as { mimeType?: unknown; data?: unknown };
        if (typeof p.mimeType === "string" && p.mimeType.startsWith("image/")) {
          return true;
        }
      }
    }
    return false;
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken,
  ): Promise<NvidiaLanguageModelChatInformation[]> {
    if (token.isCancellationRequested) {
      return [];
    }

    await this.syncConfiguredApiKey(options);

    const callNum = ++this._infoCallCounter;
    const groupName = getProviderGroupName(options);
    const hasProviderGroup = groupName !== undefined || hasProviderGroupConfiguration(options);
    const configuredApiKey = getApiKeyFromConfiguration(options);

    if (!hasProviderGroup) {
      outputLog(
        "resolution",
        `call #${callNum}: groupless - new resolution cycle, resetting duplicate guard`,
      );
      this._selectableModelIdsInCycle.clear();
      return [];
    }

    const legacyApiKey = configuredApiKey ? undefined : await this.secrets.get(SECRET_STORAGE_KEY);
    const apiKey = configuredApiKey ?? legacyApiKey;

    if (!apiKey) {
      const groupLabel = groupName ? ` "${groupName}"` : "";
      outputLog(
        "resolution",
        `call #${callNum}: provider group${groupLabel} has no configured or legacy API key`,
      );
      return [];
    }

    const models = await this.getAvailableModels(apiKey, { refreshStaleCache: true });
    const chatInformation = this._mapToChatInformation(models, apiKey);
    let duplicateCount = 0;
    for (const model of chatInformation) {
      if (this._selectableModelIdsInCycle.has(model.id)) {
        model.isUserSelectable = false;
        duplicateCount += 1;
        continue;
      }
      this._selectableModelIdsInCycle.add(model.id);
    }

    const keySource = configuredApiKey ? "configured API key" : "legacy API key fallback";
    const duplicateNote =
      duplicateCount > 0
        ? `; hid ${duplicateCount} duplicate picker entr${duplicateCount === 1 ? "y" : "ies"}`
        : "";
    const providerContext = groupName ? `provider group "${groupName}"` : "provider group";
    outputLog(
      "resolution",
      `call #${callNum}: returning ${models.length} models for ${providerContext} using ${keySource}${duplicateNote}`,
    );
    return chatInformation;
  }

  private _mapToChatInformation(
    models: readonly NormalizedNvidiaModel[],
    apiKey?: string,
  ): NvidiaLanguageModelChatInformation[] {
    return models.map((info) => {
      return {
        id: info.id,
        name: info.displayName,
        detail: PROVIDER_DISPLAY_NAME,
        tooltip: `${PROVIDER_DISPLAY_NAME} ${info.displayName}`,
        family: PROVIDER_VENDOR,
        version: "1.0.0",
        maxInputTokens: Math.max(
          1,
          info.contextWindow - Math.min(info.maxOutputTokens, DEFAULT_MAX_TOKENS),
        ),
        maxOutputTokens: info.maxOutputTokens,
        isUserSelectable: true,
        capabilities: {
          toolCalling: info.supportsTools ? 128 : false,
          imageInput: info.supportsVision,
        },
        ...(apiKey ? { apiKey } : {}),
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const abortController = new AbortController();
    const cancellationSubscription = token.onCancellationRequested(() => {
      abortController.abort();
    });

    try {
      const apiKey = await this.ensureApiKey(options, false, getApiKeyFromModel(model));
      if (!apiKey) {
        progress.report(new vscode.LanguageModelTextPart(buildMissingApiKeyFallback()));
        return;
      }

      const hasImages = this.hasImageInput(messages);
      let effectiveMessages = messages;
      let effectiveModelId = model.id;
      let effectiveModel = model;

      let { supportsTools, supportsVision, contextWindow } =
        await this.resolveChatModelRuntimeInfo(model, apiKey);

      if (hasImages && !supportsVision) {
        const visionFallback = this.getVisionFallbackModelId();
        if (visionFallback && visionFallback !== model.id) {
          effectiveModelId = visionFallback;
          const fallbackModel = this.getNormalizedModels().find((m) => m.id === visionFallback);
          const currentModel = this.getNormalizedModels().find((m) => m.id === model.id);
          const fallbackName = fallbackModel?.displayName ?? visionFallback;
          const currentName = currentModel?.displayName ?? model.id;

          progress.report(
            new vscode.LanguageModelTextPart(
              `Switching to ${fallbackName} for image analysis (${currentName} does not support vision).\n\n`,
            ),
          );

          effectiveModel = {
            ...model,
            id: visionFallback,
            name: fallbackName,
          };
          const resolved = await this.resolveChatModelRuntimeInfo(effectiveModel, apiKey);
          supportsTools = resolved.supportsTools;
          supportsVision = resolved.supportsVision;
          contextWindow = resolved.contextWindow;
        } else {
          try {
            effectiveMessages = await this.processImagesForNonVisionModel(messages, token, apiKey);
          } catch (err) {
            if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
              throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            const currentModel = this.getNormalizedModels().find((m) => m.id === model.id);
            const currentName = currentModel?.displayName ?? model.id;
            progress.report(
              new vscode.LanguageModelTextPart(
                `Image analysis failed: ${message}. The selected model (${currentName}) does not support vision and no vision fallback model is available. Please switch to a vision-capable model and try again.`,
              ),
            );
            return;
          }
        }
      }

      const inputTokenCount = estimateMessagesTokens(
        effectiveMessages as readonly { content: (vscode.LanguageModelInputPart | LegacyPart)[] }[],
      );
      const maxInputTokens = effectiveModel.maxInputTokens;

      // Apply safety margin to maxInputTokens to prevent context overflow
      const effectiveMaxInputTokens = Math.max(1, maxInputTokens - CONTEXT_WINDOW_SAFETY_MARGIN);

      if (inputTokenCount > effectiveMaxInputTokens) {
        throw new Error(
          formatStructuredError(
            "token_limit",
            `Input tokens: ${inputTokenCount}, max: ${effectiveMaxInputTokens}`,
          ),
        );
      }

      const maxTokensVal = (options.modelOptions as Record<string, unknown>)?.max_tokens;
      const requestedMaxTokens = this.calculateRequestedMaxTokens({
        requestedMaxTokens:
          typeof maxTokensVal === "number" && maxTokensVal > 0 ? maxTokensVal : DEFAULT_MAX_TOKENS,
        modelMaxOutputTokens: effectiveModel.maxOutputTokens,
        contextWindow,
        inputTokenCount,
      });

      const maxToolResultChars = this.calculateMaxToolResultChars(contextWindow);

      const toolsEnabled = Boolean(options.tools?.length);
      const adapter = getModelAdapter(effectiveModelId);
      const requestProfile = adapter.getProfile({
        toolsEnabled: supportsTools && toolsEnabled,
      });
      const userTemperature = (options.modelOptions as Record<string, unknown>)?.temperature;
      const profileTemperature =
        toolsEnabled && requestProfile.toolTemperature !== undefined
          ? requestProfile.toolTemperature
          : requestProfile.defaultTemperature;
      const temperatureVal =
        typeof userTemperature === "number" ? userTemperature : profileTemperature;

      await processOpenAIStream(
        { id: effectiveModelId, maxOutputTokens: effectiveModel.maxOutputTokens },
        effectiveMessages,
        options,
        apiKey,
        requestedMaxTokens,
        temperatureVal,
        this.userAgent,
        progress,
        token,
        abortController,
        maxToolResultChars,
        supportsVision,
      );
    } catch (err) {
      if (token.isCancellationRequested || (err instanceof Error && err.name === "AbortError")) {
        throw new vscode.CancellationError();
      }
      throw err;
    } finally {
      cancellationSubscription.dispose();
    }
  }

  provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return Promise.resolve(estimateTokens(text));
    }
    let total = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += estimateTokens(part.value);
      } else if (
        typeof part === "object" &&
        part !== null &&
        "value" in part &&
        typeof (part as { value?: unknown }).value === "string"
      ) {
        total += estimateTokens((part as { value: string }).value);
      } else {
        total += 2; // rough estimate for non-text parts
      }
    }
    return Promise.resolve(total);
  }

  private async ensureApiKey(
    options: unknown,
    silent: boolean,
    configuredApiKey?: string,
  ): Promise<string | undefined> {
    const syncedApiKey = await this.syncConfiguredApiKey(options);
    let apiKey = syncedApiKey ?? configuredApiKey ?? (await this.secrets.get(SECRET_STORAGE_KEY));
    if (!apiKey && !silent) {
      const configureAction = "Configure API Key";
      const result = await vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} API key is not configured.`,
        configureAction,
      );
      if (result === configureAction) {
        await vscode.commands.executeCommand(MANAGE_COMMAND_ID);
        apiKey = await this.secrets.get(SECRET_STORAGE_KEY);
        if (!apiKey) {
          return undefined;
        }
        return apiKey;
      }

      const entered = await vscode.window.showInputBox({
        title: `${PROVIDER_DISPLAY_NAME} API Key`,
        prompt: `Enter your ${PROVIDER_DISPLAY_NAME} API key`,
        ignoreFocusOut: true,
        password: true,
      });
      if (entered && entered.trim()) {
        apiKey = entered.trim();
        await this.secrets.store(SECRET_STORAGE_KEY, apiKey);
      }
    }
    return apiKey;
  }
}
export { NvidiaNimChatModelProvider as OcGoChatModelProvider }; // Kept for transition safety during refactoring

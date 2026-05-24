import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { fetchModels, streamChatCompletion } from "../src/api";
import { CONTEXT_WINDOW_SAFETY_MARGIN } from "../src/constants";
import { OcGoChatModelProvider } from "../src/provider";

jest.mock("../src/api", () => ({
  fetchModels: jest.fn(),
  streamChatCompletion: jest.fn(),
}));

jest.mock("vscode", () => ({
  SecretStorage: class {},
  LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 0 },
  LanguageModelChatMessage: {
    User: (content: unknown[]) => ({ role: 1, content }),
  },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  LanguageModelToolCallPart: class {
    constructor(
      public callId: string,
      public name: string,
      public input: Record<string, unknown>,
    ) {}
  },
  LanguageModelToolResultPart: class {
    constructor(
      public callId: string,
      public content: unknown[],
    ) {}
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInputBox: jest.fn(),
    showInformationMessage: jest.fn().mockResolvedValue(undefined),
  },
  LanguageModelError: {
    NoPermissions: (msg: string) => new Error(msg),
    NotFound: (msg: string) => new Error(msg),
    Blocked: (msg: string) => new Error(msg),
  },
  CancellationError: class extends Error {},
  EventEmitter: class {
    event = jest.fn();
    fire = jest.fn();
  },
  Memento: class {},
}));

interface StreamTextFixtureCase {
  name: string;
  chunks: string[];
  expectedText: string;
}

interface MixedToolCallFixtureCase {
  name: string;
  chunks: string[];
  expectedBefore: string;
  expectedAfter: string;
  expectedToolName: string;
  expectedToolInput: Record<string, string>;
}

interface InvalidToolCallFixtureCase {
  name: string;
  chunks: string[];
  expectedToolName: string;
  expectedRequiredArgs: string[];
}

interface GenericInvalidToolCallFixtureCase {
  name: string;
  modelId: string;
  chunks: string[];
  expectedBefore: string;
  expectedToolName: string;
  forbiddenMarker: string;
}

function loadProviderFixture<T>(fixtureName: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "provider", fixtureName), "utf8"),
  ) as T;
}

describe("OcGoChatModelProvider", () => {
  let secrets: vscode.SecretStorage;
  let globalState: vscode.Memento;
  let provider: OcGoChatModelProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    secrets = {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
    } as unknown as vscode.SecretStorage;
    globalState = {
      get: jest.fn().mockImplementation((key: string) =>
        key === "nvidia-nim.models"
          ? [
              {
                id: "kimi-k2.6",
                displayName: "Kimi K2.6",
                contextWindow: 262144,
                maxOutputTokens: 262144,
                supportsTools: true,
                supportsVision: true,
              },
              {
                id: "meta/llama-4-maverick-17b-128e-instruct",
                displayName: "Llama 4 Maverick 17B 128E Instruct",
                contextWindow: 131072,
                maxOutputTokens: 16384,
                supportsTools: true,
                supportsVision: false,
              },
            ]
          : undefined,
      ),
      update: jest.fn(),
      keys: jest.fn(),
    } as unknown as vscode.Memento;
    provider = new OcGoChatModelProvider(secrets, "test-ua", globalState);
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue(undefined);
  });

  it("provideLanguageModelChatInformation returns no models when no provider group API key exists", async () => {
    (globalState.get as jest.Mock).mockReturnValue(undefined);
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );
    expect(infos).toEqual([]);
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("provideLanguageModelChatInformation fetches models on demand when cache is empty and a provider group API key exists", async () => {
    (globalState.get as jest.Mock).mockReturnValue(undefined);
    (globalState.update as jest.Mock).mockResolvedValue(undefined);
    (secrets.get as jest.Mock).mockResolvedValue("legacy-key");
    (fetchModels as jest.Mock).mockResolvedValue([
      {
        id: "meta/llama-3.1-8b-instruct",
        object: "model",
        owned_by: "integrate.api.nvidia.com",
      },
    ]);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(fetchModels).toHaveBeenCalledWith("configured-key", undefined, "test-ua");
    expect(globalState.update).toHaveBeenCalledWith("nvidia-nim.models", [
      {
        id: "meta/llama-3.1-8b-instruct",
        displayName: "llama-3.1-8b-instruct",
        contextWindow: 131072,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: false,
      },
    ]);
    expect(infos).toEqual([
      expect.objectContaining({
        id: "meta/llama-3.1-8b-instruct",
        name: "llama-3.1-8b-instruct",
        detail: "NVIDIA NIM",
        apiKey: "configured-key",
      }),
    ]);
  });

  it("provideLanguageModelChatInformation uses the VS Code model configuration API key", async () => {
    (globalState.get as jest.Mock).mockReturnValue(undefined);
    (globalState.update as jest.Mock).mockResolvedValue(undefined);
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    (fetchModels as jest.Mock).mockResolvedValue([
      {
        id: "meta/llama-3.1-8b-instruct",
        object: "model",
        owned_by: "integrate.api.nvidia.com",
      },
    ]);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(fetchModels).toHaveBeenCalledWith("configured-key", undefined, "test-ua");
    expect(secrets.get).not.toHaveBeenCalledWith("nvidia-nim.apiKey");
    expect(infos).toEqual([
      expect.objectContaining({
        id: "meta/llama-3.1-8b-instruct",
        apiKey: "configured-key",
      }),
    ]);
  });

  it("does not return legacy cached models for groupless resolution", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "deepseek-ai/deepseek-v4-pro",
            displayName: "deepseek-v4-pro",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    (secrets.get as jest.Mock).mockResolvedValue("legacy-key");
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );

    expect(infos).toEqual([]);
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("treats an undefined configuration property as groupless resolution", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "deepseek-ai/deepseek-v4-pro",
            displayName: "deepseek-v4-pro",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    (secrets.get as jest.Mock).mockResolvedValue("legacy-key");
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: undefined } as any,
      token as any,
    );

    expect(infos).toEqual([]);
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("uses the legacy API key fallback for a configuration-only provider group missing an api key", async () => {
    (globalState.get as jest.Mock).mockReturnValue(undefined);
    (globalState.update as jest.Mock).mockResolvedValue(undefined);
    (secrets.get as jest.Mock).mockResolvedValue("legacy-key");
    (fetchModels as jest.Mock).mockResolvedValue([
      {
        id: "deepseek-ai/deepseek-v4-pro",
        object: "model",
        owned_by: "deepseek-ai",
      },
    ]);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: {} } as any,
      token as any,
    );

    expect(fetchModels).toHaveBeenCalledWith("legacy-key", undefined, "test-ua");
    expect(infos).toEqual([
      expect.objectContaining({
        id: "deepseek-ai/deepseek-v4-pro",
        name: "deepseek-v4-pro",
        apiKey: "legacy-key",
        isUserSelectable: true,
      }),
    ]);
  });

  it("keeps a configuration-only provider group selectable after a groupless reset", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "deepseek-ai/deepseek-v4-pro",
            displayName: "deepseek-v4-pro",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    (secrets.get as jest.Mock).mockResolvedValue("legacy-key");
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const grouplessInfos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );
    const groupInfos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: {} } as any,
      token as any,
    );

    expect(grouplessInfos).toEqual([]);
    expect(groupInfos).toHaveLength(1);
    expect(groupInfos[0]).toEqual(
      expect.objectContaining({
        id: "deepseek-ai/deepseek-v4-pro",
        apiKey: "legacy-key",
        isUserSelectable: true,
      }),
    );
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("keeps duplicate configured provider group models resolvable but hides them from the picker", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "meta/llama-3.1-8b-instruct",
            displayName: "llama-3.1-8b-instruct",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatInformation({ silent: true } as any, token as any);
    const firstInfos = await provider.provideLanguageModelChatInformation(
      { group: "NVIDIA NIM", silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );
    const duplicateInfos = await provider.provideLanguageModelChatInformation(
      { group: "NVIDIA NIM 2", silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(firstInfos).toHaveLength(1);
    expect(firstInfos[0]).toEqual(expect.objectContaining({ isUserSelectable: true }));
    expect(duplicateInfos).toHaveLength(1);
    expect(duplicateInfos[0]).toEqual(expect.objectContaining({ isUserSelectable: false }));
  });

  it("hides duplicate model ids from a second provider group even when it uses a different API key", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "meta/llama-3.1-8b-instruct",
            displayName: "llama-3.1-8b-instruct",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatInformation({ silent: true } as any, token as any);
    const firstInfos = await provider.provideLanguageModelChatInformation(
      { group: "NVIDIA NIM", silent: true, configuration: { apiKey: "key-aaa" } } as any,
      token as any,
    );
    const differentKeyInfos = await provider.provideLanguageModelChatInformation(
      { group: "NVIDIA NIM 2", silent: true, configuration: { apiKey: "key-bbb" } } as any,
      token as any,
    );

    expect(firstInfos).toHaveLength(1);
    expect(firstInfos[0]).toEqual(expect.objectContaining({ isUserSelectable: true }));
    expect(differentKeyInfos).toHaveLength(1);
    expect(differentKeyInfos[0]).toEqual(expect.objectContaining({ isUserSelectable: false }));
  });

  it("allows the same configured provider group again after a new provider resolution cycle starts", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "meta/llama-3.1-8b-instruct",
            displayName: "llama-3.1-8b-instruct",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatInformation({ silent: true } as any, token as any);
    await provider.provideLanguageModelChatInformation(
      { group: "NVIDIA NIM", silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );
    await provider.provideLanguageModelChatInformation({ silent: true } as any, token as any);
    const infos = await provider.provideLanguageModelChatInformation(
      { group: "NVIDIA NIM", silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(infos).toHaveLength(1);
  });

  it("refreshes stale cached models when a configured API key is available", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "stale-model",
            displayName: "Stale Model",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: false,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return undefined;
      }
      return undefined;
    });
    (globalState.update as jest.Mock).mockResolvedValue(undefined);
    (fetchModels as jest.Mock).mockResolvedValue([
      {
        id: "meta/llama-3.1-8b-instruct",
        object: "model",
        owned_by: "integrate.api.nvidia.com",
      },
    ]);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(fetchModels).toHaveBeenCalledWith("configured-key", undefined, "test-ua");
    expect(infos[0]).toEqual(
      expect.objectContaining({
        id: "meta/llama-3.1-8b-instruct",
        isUserSelectable: true,
      }),
    );
  });

  it("keeps stale cached models visible when refreshing them fails", async () => {
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return [
          {
            id: "stale-model",
            displayName: "Stale Model",
            contextWindow: 131072,
            maxOutputTokens: 16384,
            supportsTools: false,
            supportsVision: false,
          },
        ];
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return undefined;
      }
      return undefined;
    });
    (fetchModels as jest.Mock).mockResolvedValue(null);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(fetchModels).toHaveBeenCalledWith("configured-key", undefined, "test-ua");
    expect(infos).toEqual([
      expect.objectContaining({
        id: "stale-model",
        isUserSelectable: true,
      }),
    ]);
  });

  it("provideLanguageModelChatInformation returns cached normalized models for a configured provider group", async () => {
    const cachedModels = [
      {
        id: "cached-model",
        displayName: "Cached Model",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: false,
        supportsVision: false,
      },
    ];
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return cachedModels;
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );
    expect(infos.length).toBe(1);
    expect(infos[0].id).toBe("cached-model");
    expect(infos[0].detail).toBe("NVIDIA NIM");
    expect(infos[0].tooltip).toBe("NVIDIA NIM Cached Model");
    expect(infos[0].family).toBe("nvidia-nim");
    expect(infos[0]).toEqual(expect.objectContaining({ isUserSelectable: true }));
    expect(globalState.get).toHaveBeenCalledWith("nvidia-nim.models");
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("provideLanguageModelChatInformation returns no models when the cache is not normalized", async () => {
    (globalState.get as jest.Mock).mockReturnValue([{ id: "cached-model", name: "Cached Model" }]);
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );

    expect(infos).toEqual([]);
  });

  it.each([{}, "bad-cache", 123])(
    "provideLanguageModelChatInformation returns no models when cache is malformed non-array: %p",
    async (malformedCache) => {
      (globalState.get as jest.Mock).mockReturnValue(malformedCache);
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const infos = await provider.provideLanguageModelChatInformation(
        { silent: true } as any,
        token as any,
      );

      expect(infos).toEqual([]);
    },
  );

  it("does not advertise image input for non-vision normalized models", async () => {
    const cachedModels = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: false,
      },
    ];
    (globalState.get as jest.Mock).mockImplementation((key: string) => {
      if (key === "nvidia-nim.models") {
        return cachedModels;
      }
      if (key === "nvidia-nim.modelsCacheVersion") {
        return 3;
      }
      return undefined;
    });
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "configured-key" } } as any,
      token as any,
    );

    expect(infos).toHaveLength(1);
    expect(infos[0].capabilities?.imageInput).toBe(false);
    expect(infos[0].capabilities?.toolCalling).toBe(128);
  });

  it("provideLanguageModelChatInformation returns empty array on cancellation", async () => {
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );
    expect(infos).toEqual([]);
  });

  it("provideLanguageModelChatResponse streams text parts", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello" } }] };
      yield { choices: [{ delta: { content: " world" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ model: "kimi-k2.6", stream: true }),
      expect.any(AbortSignal),
      "test-ua",
      { maxOutputTokens: 65536 },
    );
    expect(progress.report).toHaveBeenCalledTimes(1);
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: "Hello world" }));
  });

  it("strips think tags even when the stream splits tag boundaries", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "<th" } }] };
      yield { choices: [{ delta: { content: "ink>hidden" } }] };
      yield { choices: [{ delta: { content: "</th" } }] };
      yield { choices: [{ delta: { content: "ink>表示テキスト" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "nim-any-model", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(progress.report).toHaveBeenCalledTimes(1);
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ value: "表示テキスト" }),
    );
  });

  it("does not fetch models during chat when the selected model already exposes capabilities", async () => {
    (globalState.get as jest.Mock).mockReturnValue(undefined);
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: "kimi-k2.6",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
        capabilities: {
          toolCalling: 128,
          imageInput: false,
        },
      } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    expect(fetchModels).not.toHaveBeenCalled();
    const requestBody = (streamChatCompletion as jest.Mock).mock.calls[0][1];
    expect(requestBody.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ function: expect.objectContaining({ name: "read_file" }) }),
      ]),
    );
  });

  it("reports unsupported image input for non-vision normalized models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockReturnValue([
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: false,
      },
    ]);

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        maxInputTokens: 100000,
        maxOutputTokens: 16384,
      } as any,
      [
        {
          role: 1,
          content: [
            { value: "What is in this image?" },
            { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.stringContaining("does not support vision") }),
    );
  });

  it("automatically switches to a vision-capable fallback model when image input is provided to a non-vision model", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockReturnValue([
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: false,
      },
      {
        id: "nvidia/vision-capable-fallback",
        displayName: "NVIDIA Vision Fallback Model",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: true,
      },
    ]);

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Switched vision response" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        maxInputTokens: 100000,
        maxOutputTokens: 16384,
      } as any,
      [
        {
          role: 1,
          content: [
            { value: "Identify this image" },
            { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    // Should inform the user about the model switch
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({
        value: expect.stringContaining("Switching to NVIDIA Vision Fallback Model for image analysis"),
      }),
    );

    // Should call streamChatCompletion using the switched fallback model
    expect(streamChatCompletion).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({
        model: "nvidia/vision-capable-fallback",
      }),
      expect.any(AbortSignal),
      "test-ua",
      { maxOutputTokens: 16384 },
    );
  });

  it("performs background image analysis OCR fallback when no vision fallback model is in the catalog", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockReturnValue([
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: false,
      },
    ]);

    // Mock mcpClient.analyzeImage
    const analyzeImageSpy = jest
      .spyOn((provider as any).mcpClient, "analyzeImage")
      .mockResolvedValue("Mocked visual description of image contents");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Text model response" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        maxInputTokens: 100000,
        maxOutputTokens: 16384,
      } as any,
      [
        {
          role: 1,
          content: [
            { value: "Describe the image" },
            { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(analyzeImageSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/png;base64,/),
      "Describe the image",
      expect.any(AbortSignal),
      "test-key",
    );

    // Should call streamChatCompletion using the text-only model with the injected description
    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)[1];
    expect(requestBody.model).toBe("meta/llama-4-maverick-17b-128e-instruct");
    expect(requestBody.messages[0].content).toContain("[Image Analysis]");
    expect(requestBody.messages[0].content).toContain("Mocked visual description of image contents");

    analyzeImageSpy.mockRestore();
  });

  it("converts image parts to image_url content for vision-capable normalized models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockReturnValue([
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: true,
      },
    ]);

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Vision reply" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        maxInputTokens: 100000,
        maxOutputTokens: 16384,
      } as any,
      [
        {
          role: 1,
          content: [
            { value: "What is in this image?" },
            { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls[0][1];
    expect(requestBody.model).toBe("meta/llama-4-maverick-17b-128e-instruct");
    expect(requestBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "image_url",
              image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
            }),
          ]),
        }),
      ]),
    );
  });

  it("throws when message exceeds token limit", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await expect(
      provider.provideLanguageModelChatResponse(
        { id: "kimi-k2.6", maxInputTokens: 1, maxOutputTokens: 65536 } as any,
        [
          {
            role: 1,
            content: [{ value: "This is a very long message that exceeds the token limit" }],
          },
        ] as any,
        { modelOptions: {} } as any,
        progress,
        token as any,
      ),
    ).rejects.toThrow("[TOKEN_LIMIT_EXCEEDED]");
  });

  it("caps max_tokens to the remaining context budget", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockImplementation((key: string) =>
      key === "nvidia-nim.models"
        ? [
            {
              id: "kimi-k2.6",
              displayName: "Kimi K2.6",
              contextWindow: 70000,
              maxOutputTokens: 200000,
              supportsTools: true,
              supportsVision: false,
            },
          ]
        : undefined,
    );

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const prompt = "a".repeat(900);

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 5000, maxOutputTokens: 200000 } as any,
      [{ role: 1, content: [{ value: prompt }] }] as any,
      { modelOptions: { max_tokens: 120000 } } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];
    const expectedRemainingBudget = 70000 - 300 - CONTEXT_WINDOW_SAFETY_MARGIN;

    expect(requestBody.max_tokens).toBe(expectedRemainingBudget);
  });

  it("logs first token latency and total stream duration when debug logging is enabled", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1125)
      .mockReturnValueOnce(1450);

    try {
      const mockStream = async function* () {
        yield { choices: [{ delta: { content: "done" } }] };
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;

      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Inspect the workspace" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        { modelOptions: {} } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          attempt: 1,
          model: "kimi-k2.6",
          firstTokenLatencyMs: 125,
          totalDurationMs: 450,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("includes request preparation duration in the stream timing log", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1250)
      .mockReturnValueOnce(1400)
      .mockReturnValueOnce(2100);

    try {
      const mockStream = async function* () {
        yield { choices: [{ delta: { content: "done" } }] };
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;

      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Inspect the workspace" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        { modelOptions: {} } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          requestPreparationDurationMs: 250,
          firstTokenLatencyMs: 150,
          totalDurationMs: 850,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("includes tool parsing state initialization duration in the stream timing log", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1200)
      .mockReturnValueOnce(1250)
      .mockReturnValueOnce(1290)
      .mockReturnValueOnce(1350)
      .mockReturnValueOnce(1500);

    try {
      const mockStream = async function* () {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"filePath":"/tmp/example.md","startLine":1,"endLine":20}',
                    },
                  },
                ],
              },
            },
          ],
        };
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;

      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Read the file" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        {
          modelOptions: {},
          tools: [
            {
              name: "read_file",
              description: "Read a file from disk",
              inputSchema: {
                type: "object",
                properties: {
                  filePath: { type: "string" },
                  startLine: { type: "number" },
                  endLine: { type: "number" },
                },
                required: ["filePath", "startLine", "endLine"],
              },
            },
          ],
        } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          requestPreparationDurationMs: 100,
          firstTokenLatencyMs: 100,
          toolParsingStateInitDurationMs: 40,
          totalDurationMs: 400,
          emittedToolCall: true,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("includes usage-derived throughput metrics in the stream timing log when usage is available", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2200)
      .mockReturnValueOnce(3000);

    try {
      const mockStream = async function* () {
        yield {
          choices: [{ delta: { content: "done" } }],
          usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
        };
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;

      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Inspect the workspace" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        { modelOptions: {} } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
          generationDurationMs: 800,
          completionTokensPerSecond: 100,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("logs the selected model as the runtime metadata source when chat skips model fetching", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (globalState.get as jest.Mock).mockReturnValue(undefined);
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(4000)
      .mockReturnValueOnce(4000)
      .mockReturnValueOnce(4075)
      .mockReturnValueOnce(4300);

    try {
      const mockStream = async function* () {
        yield { choices: [{ delta: { content: "done" } }] };
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;

      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
          capabilities: {
            toolCalling: 128,
            imageInput: false,
          },
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Inspect the workspace" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        {
          modelOptions: {},
          tools: [
            {
              name: "read_file",
              description: "Read a file from disk",
              inputSchema: {
                type: "object",
                properties: {
                  filePath: { type: "string" },
                  startLine: { type: "number" },
                  endLine: { type: "number" },
                },
                required: ["filePath", "startLine", "endLine"],
              },
            },
          ],
        } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(fetchModels).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          runtimeMetadataSource: "selected-model",
          toolsEnabled: true,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("includes request context and retry metadata in stream timing logs for invalid tool retries", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1050)
      .mockReturnValueOnce(1060)
      .mockReturnValueOnce(1090)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2125)
      .mockReturnValueOnce(2200)
      .mockReturnValueOnce(2600);

    const invalidStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };

    const repairedStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_2",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":1,"endLine":20}',
                  },
                },
              ],
            },
          },
        ],
      };
    };

    (streamChatCompletion as jest.Mock)
      .mockImplementationOnce(() => invalidStream())
      .mockImplementationOnce(() => repairedStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;

    try {
      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Read the file" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        {
          modelOptions: {},
          tools: [
            {
              name: "read_file",
              description: "Read a file from disk",
              inputSchema: {
                type: "object",
                properties: {
                  filePath: { type: "string" },
                  startLine: { type: "number" },
                  endLine: { type: "number" },
                },
                required: ["filePath", "startLine", "endLine"],
              },
            },
          ],
        } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          attempt: 1,
          toolsEnabled: true,
          requestedMaxTokens: 65536,
          temperature: 0.1,
          inputTokenCount: expect.any(Number),
          isRetryAttempt: false,
          willRetryAfterInvalidToolCall: true,
          retryReason: "invalid_tool_call",
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          attempt: 2,
          toolsEnabled: true,
          requestedMaxTokens: 65536,
          temperature: 0.1,
          inputTokenCount: expect.any(Number),
          isRetryAttempt: true,
          willRetryAfterInvalidToolCall: false,
          retryReason: "invalid_tool_call",
          emittedToolCall: true,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("includes skipped tool call summary fields in stream timing logs", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(5050)
      .mockReturnValueOnce(5060)
      .mockReturnValueOnce(5090)
      .mockReturnValueOnce(5100)
      .mockReturnValueOnce(6000)
      .mockReturnValueOnce(6125)
      .mockReturnValueOnce(6200)
      .mockReturnValueOnce(6600);

    const invalidStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };

    const repairedStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_2",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":1,"endLine":20}',
                  },
                },
              ],
            },
          },
        ],
      };
    };

    (streamChatCompletion as jest.Mock)
      .mockImplementationOnce(() => invalidStream())
      .mockImplementationOnce(() => repairedStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;

    try {
      await provider.provideLanguageModelChatResponse(
        {
          id: "kimi-k2.6",
          maxInputTokens: 100000,
          maxOutputTokens: 65536,
        } as unknown as vscode.LanguageModelChatInformation,
        [
          { role: 1, content: [{ value: "Read the file" }] },
        ] as unknown as vscode.LanguageModelChatMessage[],
        {
          modelOptions: {},
          tools: [
            {
              name: "read_file",
              description: "Read a file from disk",
              inputSchema: {
                type: "object",
                properties: {
                  filePath: { type: "string" },
                  startLine: { type: "number" },
                  endLine: { type: "number" },
                },
                required: ["filePath", "startLine", "endLine"],
              },
            },
          ],
        } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        token,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          attempt: 1,
          skippedToolCallCount: 1,
          skippedToolCallNames: ["read_file"],
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[NVIDIA NIM Debug] stream timing:",
        expect.objectContaining({
          attempt: 2,
          skippedToolCallCount: 0,
        }),
      );
    } finally {
      nowSpy.mockRestore();
      consoleSpy.mockRestore();
      delete process.env.NVIDIA_NIM_DEBUG;
    }
  });

  it("prompts for an API key during chat and continues the request when one is provided", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue("new-api-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello from NVIDIA NIM" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect((vscode as any).window.showInputBox).toHaveBeenCalled();
    expect(secrets.store).toHaveBeenCalledWith("nvidia-nim.apiKey", "new-api-key");
    expect(streamChatCompletion).toHaveBeenCalledWith(
      "new-api-key",
      expect.objectContaining({ model: "kimi-k2.6", stream: true }),
      expect.any(AbortSignal),
      "test-ua",
      { maxOutputTokens: 65536 },
    );
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ value: "Hello from NVIDIA NIM" }),
    );
  });

  it("uses the API key carried by the configured model for chat requests", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello from configured key" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());
    const progress = { report: jest.fn() };

    await provider.provideLanguageModelChatResponse(
      {
        id: "configured-model",
        name: "Configured Model",
        family: "nvidia-nim",
        version: "1.0.0",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
        capabilities: {},
        apiKey: "configured-key",
      } as any,
      [vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart("Hi")])],
      { modelOptions: {} } as any,
      progress as any,
      {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledWith(
      "configured-key",
      expect.anything(),
      expect.any(AbortSignal),
      "test-ua",
      { maxOutputTokens: 65536 },
    );
    expect((vscode as any).window.showInputBox).not.toHaveBeenCalled();
  });

  it("returns setup guidance in chat when no API key is available", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue(undefined);

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.stringContaining("NVIDIA NIM API key") }),
    );
  });

  it("streams tool call parts", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockReturnValue([
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        contextWindow: 131072,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: false,
      },
    ]);

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city": "Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        maxInputTokens: 100000,
        maxOutputTokens: 16384,
      } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({
        model: "meta/llama-4-maverick-17b-128e-instruct",
        tools: expect.any(Array),
      }),
      expect.any(AbortSignal),
      "test-ua",
      { maxOutputTokens: 16384 },
    );
    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports.length).toBe(1);
    expect(toolCallReports[0][0].callId).toBe("call_1");
    expect(toolCallReports[0][0].name).toBe("get_weather");
    expect(toolCallReports[0][0].input).toEqual({ city: "Tokyo" });
  });

  it("emits text that appears before a tool call in the same response", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Let me check " } }] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    expect(progress.report.mock.calls).toHaveLength(2);
    expect(progress.report.mock.calls[0][0]).toEqual(
      expect.objectContaining({ value: "Let me check " }),
    );
    expect(progress.report.mock.calls[1][0]).toEqual(
      expect.objectContaining({ callId: "call_1", name: "get_weather" }),
    );
  });

  it("emits text that appears after a tool call in the same response", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
      yield { choices: [{ delta: { content: "Now I have the weather." } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    expect(progress.report.mock.calls).toHaveLength(2);
    expect(progress.report.mock.calls[0][0]).toEqual(
      expect.objectContaining({ callId: "call_1", name: "get_weather" }),
    );
    expect(progress.report.mock.calls[1][0]).toEqual(
      expect.objectContaining({ value: "Now I have the weather." }),
    );
  });

  it("sends required tool choice when tool mode requires a tool", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
        toolMode: 2,
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];
    expect(requestBody.tool_choice).toBe("required");
  });

  it("assembles tool call arguments split across chunks", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city": ' },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '"Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports.length).toBe(1);
    expect(toolCallReports[0][0].input).toEqual({ city: "Tokyo" });
  });

  it("does not emit tool calls with empty arguments when schema requires fields", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(0);
  });

  it("returns a text fallback when all tool calls are skipped as invalid", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("filePath");
    expect(textReports[0][0].value).toContain("read_file");
  });

  it("retries once when the model emits an invalid required-argument tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const invalidStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };

    const repairedStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_2",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":1,"endLine":20}',
                  },
                },
              ],
            },
          },
        ],
      };
    };

    (streamChatCompletion as jest.Mock)
      .mockImplementationOnce(() => invalidStream())
      .mockImplementationOnce(() => repairedStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledTimes(2);

    const retryRequest = (streamChatCompletion as jest.Mock).mock.calls[1][1];
    expect(retryRequest.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("read_file"),
        }),
      ]),
    );
    expect(retryRequest.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("filePath, startLine, endLine"),
        }),
      ]),
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 1,
      endLine: 20,
    });
    expect(textReports).toHaveLength(0);
  });

  it("prefers required-argument retry guidance when multiple invalid tool calls are skipped", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const invalidStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/tmp"<|tool_call_end|>',
            },
          },
        ],
      };

      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };

    const repairedStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_2",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":1,"endLine":20}',
                  },
                },
              ],
            },
          },
        ],
      };
    };

    (streamChatCompletion as jest.Mock)
      .mockImplementationOnce(() => invalidStream())
      .mockImplementationOnce(() => repairedStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List directory entries",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledTimes(2);

    const retryRequest = (streamChatCompletion as jest.Mock).mock.calls[1][1];
    const retryMessage = retryRequest.messages[retryRequest.messages.length - 1];
    expect(retryMessage).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("read_file"),
      }),
    );
    expect(retryMessage.content).toContain("filePath, startLine, endLine");
    expect(retryMessage.content).not.toContain("list_dir with invalid arguments");

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 1,
      endLine: 20,
    });
    expect(textReports).toHaveLength(0);
  });

  it("prefers required-argument fallback text when multiple invalid tool calls are skipped twice", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const invalidStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/tmp"<|tool_call_end|>',
            },
          },
        ],
      };

      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };

    (streamChatCompletion as jest.Mock)
      .mockImplementationOnce(() => invalidStream())
      .mockImplementationOnce(() => invalidStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List directory entries",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledTimes(2);

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(0);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("read_file");
    expect(textReports[0][0].value).toContain("filePath");
    expect(textReports[0][0].value).toContain("startLine");
    expect(textReports[0][0].value).toContain("endLine");
    expect(textReports[0][0].value).not.toContain("list_dir with invalid arguments");
  });

  it("returns a text fallback when invalid tool calls are preceded by whitespace content", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: " " } }] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("filePath");
    expect(textReports[0][0].value).toContain("read_file");
  });

  it("emits a tool call parsed from text-embedded control tokens", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"/tmp/example.md"}<|tool_call_end|>',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
  });

  it("emits a tool call parsed from DeepSeek-style text-embedded control tokens", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>read_file\n```json\n{"filePath":"/tmp/example.md"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "deepseek-ai/deepseek-v4-pro", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
    expect(textReports).toHaveLength(0);
  });

  it("strips raw DSML control markers from streamed text output", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content: "Let me inspect the workspace.\n\n<｜DSML｜tool_calls",
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "deepseek-ai/deepseek-v4-pro", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Inspect the workspace" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toBe("Let me inspect the workspace.\n\n");
  });

  it.each(
    loadProviderFixture<StreamTextFixtureCase[]>("split-dsml-control-text.json").map(
      ({ name, chunks, expectedText }) => [name, chunks, expectedText] as const,
    ),
  )(
    "strips split DSML control markers from streamed text output: %s",
    async (_fixtureName: string, chunks: string[], expectedText: string) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const mockStream = async function* () {
        for (const content of chunks) {
          yield {
            choices: [
              {
                delta: {
                  content,
                },
              },
            ],
          };
        }
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: "deepseek-ai/deepseek-v4-pro",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("Inspect the workspace")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      const textReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "value" in (call[0] as object),
      );

      expect(textReports).toHaveLength(1);
      expect(textReports[0][0]).toEqual(expect.objectContaining({ value: expectedText }));
    },
  );

  it.each(
    loadProviderFixture<StreamTextFixtureCase[]>("truncated-control-text.json").map(
      ({ name, chunks, expectedText }) => [name, chunks, expectedText] as const,
    ),
  )(
    "suppresses truncated control text at stream end: %s",
    async (_fixtureName: string, chunks: string[], expectedText: string) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const mockStream = async function* () {
        for (const content of chunks) {
          yield {
            choices: [
              {
                delta: {
                  content,
                },
              },
            ],
          };
        }
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: "deepseek-ai/deepseek-v4-pro",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("Inspect the workspace")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      const textReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "value" in (call[0] as object),
      );

      expect(textReports).toHaveLength(1);
      expect(textReports[0][0]).toEqual(expect.objectContaining({ value: expectedText }));
    },
  );

  it.each(
    loadProviderFixture<MixedToolCallFixtureCase[]>("deepseek-mixed-tool-call.json").map(
      ({ name, chunks, expectedBefore, expectedAfter, expectedToolName, expectedToolInput }) =>
        [name, chunks, expectedBefore, expectedAfter, expectedToolName, expectedToolInput] as const,
    ),
  )(
    "preserves text order around a DeepSeek-style tool call: %s",
    async (
      _fixtureName: string,
      chunks: string[],
      expectedBefore: string,
      expectedAfter: string,
      expectedToolName: string,
      expectedToolInput: Record<string, string>,
    ) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const mockStream = async function* () {
        for (const content of chunks) {
          yield {
            choices: [
              {
                delta: {
                  content,
                },
              },
            ],
          };
        }
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: "deepseek-ai/deepseek-v4-pro",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("Inspect the workspace")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      expect(progress.report.mock.calls).toHaveLength(3);
      expect(progress.report.mock.calls[0][0]).toEqual(
        expect.objectContaining({ value: expectedBefore }),
      );
      expect(progress.report.mock.calls[1][0]).toEqual(
        expect.objectContaining({ name: expectedToolName, input: expectedToolInput }),
      );
      expect(progress.report.mock.calls[2][0]).toEqual(
        expect.objectContaining({ value: expectedAfter }),
      );
    },
  );

  it.each(
    loadProviderFixture<InvalidToolCallFixtureCase[]>("deepseek-invalid-tool-call.json").map(
      ({ name, chunks, expectedToolName, expectedRequiredArgs }) =>
        [name, chunks, expectedToolName, expectedRequiredArgs] as const,
    ),
  )(
    "falls back to text for malformed DeepSeek-style tool calls: %s",
    async (
      _fixtureName: string,
      chunks: string[],
      expectedToolName: string,
      expectedRequiredArgs: string[],
    ) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const mockStream = async function* () {
        for (const content of chunks) {
          yield {
            choices: [
              {
                delta: {
                  content,
                },
              },
            ],
          };
        }
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: "deepseek-ai/deepseek-v4-pro",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("Read the file")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      const toolCallReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "callId" in (call[0] as object),
      );
      const textReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "value" in (call[0] as object),
      );

      expect(toolCallReports).toHaveLength(0);
      expect(textReports).toHaveLength(1);
      expect(textReports[0][0]).toEqual(
        expect.objectContaining({
          value: expect.stringContaining(expectedToolName),
        }),
      );
      for (const arg of expectedRequiredArgs) {
        expect(textReports[0][0]).toEqual(
          expect.objectContaining({
            value: expect.stringContaining(arg),
          }),
        );
      }
      expect(textReports[0][0]).toEqual(
        expect.not.objectContaining({
          value: expect.stringContaining("<｜tool"),
        }),
      );
    },
  );

  it.each(
    loadProviderFixture<InvalidToolCallFixtureCase[]>("openai-invalid-tool-call.json").map(
      ({ name, chunks, expectedToolName, expectedRequiredArgs }) =>
        [name, chunks, expectedToolName, expectedRequiredArgs] as const,
    ),
  )(
    "falls back to text for malformed OpenAI-style tool calls: %s",
    async (
      _fixtureName: string,
      chunks: string[],
      expectedToolName: string,
      expectedRequiredArgs: string[],
    ) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const mockStream = async function* () {
        for (const content of chunks) {
          yield {
            choices: [
              {
                delta: {
                  content,
                },
              },
            ],
          };
        }
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: "kimi-k2.6",
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("Read the file")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      const toolCallReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "callId" in (call[0] as object),
      );
      const textReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "value" in (call[0] as object),
      );

      expect(toolCallReports).toHaveLength(0);
      expect(textReports).toHaveLength(1);
      expect(textReports[0][0]).toEqual(
        expect.objectContaining({
          value: expect.stringContaining(expectedToolName),
        }),
      );
      for (const arg of expectedRequiredArgs) {
        expect(textReports[0][0]).toEqual(
          expect.objectContaining({
            value: expect.stringContaining(arg),
          }),
        );
      }
      expect(textReports[0][0]).toEqual(
        expect.not.objectContaining({
          value: expect.stringContaining("<|tool_call"),
        }),
      );
    },
  );

  it.each(
    loadProviderFixture<GenericInvalidToolCallFixtureCase[]>("generic-invalid-tool-call.json").map(
      ({ name, modelId, chunks, expectedBefore, expectedToolName, forbiddenMarker }) =>
        [name, modelId, chunks, expectedBefore, expectedToolName, forbiddenMarker] as const,
    ),
  )(
    "returns a generic fallback for malformed optional-argument tool calls: %s",
    async (
      _fixtureName: string,
      modelId: string,
      chunks: string[],
      expectedBefore: string,
      expectedToolName: string,
      forbiddenMarker: string,
    ) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const mockStream = async function* () {
        for (const content of chunks) {
          yield {
            choices: [
              {
                delta: {
                  content,
                },
              },
            ],
          };
        }
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: modelId,
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("List the directory")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List directory entries",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        ],
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      const toolCallReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "callId" in (call[0] as object),
      );
      const textReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "value" in (call[0] as object),
      );

      expect(toolCallReports).toHaveLength(0);
      expect(textReports).toHaveLength(2);
      expect(textReports[0][0]).toEqual(expect.objectContaining({ value: expectedBefore }));
      expect(textReports[1][0]).toEqual(
        expect.objectContaining({
          value: expect.stringContaining(expectedToolName),
        }),
      );
      expect(textReports[1][0]).toEqual(
        expect.objectContaining({
          value: expect.stringContaining("invalid arguments"),
        }),
      );
      expect(textReports[1][0]).toEqual(
        expect.not.objectContaining({
          value: expect.stringContaining(forbiddenMarker),
        }),
      );
    },
  );

  it.each([
    {
      name: "openai-style optional tool call",
      modelId: "kimi-k2.6",
      invalidChunks: [
        '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/tmp"<|tool_call_end|>',
      ],
      repairedChunks: [
        '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/tmp"}<|tool_call_end|>',
      ],
      forbiddenMarker: "<|tool_call",
    },
    {
      name: "DeepSeek-style optional tool call",
      modelId: "deepseek-ai/deepseek-v4-pro",
      invalidChunks: [
        '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>list_dir\n```json\n{"path":"/tmp"\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
      ],
      repairedChunks: [
        '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>list_dir\n```json\n{"path":"/tmp"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
      ],
      forbiddenMarker: "<｜tool",
    },
  ])(
    "retries once when the model emits a malformed optional-argument tool call: $name",
    async ({ modelId, invalidChunks, repairedChunks, forbiddenMarker }) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");

      const invalidStream = async function* () {
        for (const content of invalidChunks) {
          yield { choices: [{ delta: { content } }] };
        }
      };

      const repairedStream = async function* () {
        for (const content of repairedChunks) {
          yield { choices: [{ delta: { content } }] };
        }
      };

      (streamChatCompletion as jest.Mock)
        .mockImplementationOnce(() => invalidStream())
        .mockImplementationOnce(() => repairedStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: modelId,
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("List the directory")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List directory entries",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
        ],
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      expect(streamChatCompletion).toHaveBeenCalledTimes(2);

      const retryRequest = (streamChatCompletion as jest.Mock).mock.calls[1][1];
      expect(retryRequest.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("list_dir"),
          }),
        ]),
      );
      expect(retryRequest.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("invalid or incomplete arguments"),
          }),
        ]),
      );
      expect(retryRequest.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("Do not emit malformed JSON or empty arguments."),
          }),
        ]),
      );

      const toolCallReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "callId" in (call[0] as object),
      );
      const textReports = progress.report.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "object" && call[0] !== null && "value" in (call[0] as object),
      );

      expect(toolCallReports).toHaveLength(1);
      expect(toolCallReports[0][0]).toEqual(
        expect.objectContaining({
          name: "list_dir",
          input: { path: "/tmp" },
        }),
      );
      expect(textReports).toHaveLength(0);
      expect(retryRequest.messages).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining(forbiddenMarker),
          }),
        ]),
      );
    },
  );

  it("applies the DeepSeek request profile defaults when tools are enabled", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockImplementation((key: string) =>
      key === "nvidia-nim.models"
        ? [
            {
              id: "deepseek-ai/deepseek-v4-pro",
              displayName: "deepseek-v4-pro",
              contextWindow: 131072,
              maxOutputTokens: 16384,
              supportsTools: true,
              supportsVision: false,
            },
          ]
        : undefined,
    );

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "deepseek-ai/deepseek-v4-pro", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Inspect the workspace" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];

    expect(requestBody.temperature).toBe(0);
    expect(requestBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Do not reveal internal control tokens"),
        }),
      ]),
    );
  });

  it("keeps explicit temperature overrides for DeepSeek request profiles", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");
    (globalState.get as jest.Mock).mockImplementation((key: string) =>
      key === "nvidia-nim.models"
        ? [
            {
              id: "deepseek-ai/deepseek-v4-pro",
              displayName: "deepseek-v4-pro",
              contextWindow: 131072,
              maxOutputTokens: 16384,
              supportsTools: true,
              supportsVision: false,
            },
          ]
        : undefined,
    );

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "deepseek-ai/deepseek-v4-pro", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Inspect the workspace" }] }] as any,
      {
        modelOptions: { temperature: 0.35 },
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];

    expect(requestBody.temperature).toBe(0.35);
  });

  it.each([
    ["kimi-k2.6", 0.1, "Do not reveal chain-of-thought"],
    ["zai-org/glm-4.5", 0.05, "strict JSON arguments"],
    ["meta/llama-4-maverick-17b-128e-instruct", 0.1, "Do not emit pseudo tool syntax"],
  ])(
    "applies the provider request profile for %s when tools are enabled",
    async (modelId: string, expectedTemperature: number, expectedMessageSnippet: string) => {
      (secrets.get as jest.Mock).mockResolvedValue("test-key");
      (globalState.get as jest.Mock).mockImplementation((key: string) =>
        key === "nvidia-nim.models"
          ? [
              {
                id: modelId,
                displayName: modelId,
                contextWindow: 131072,
                maxOutputTokens: 16384,
                supportsTools: true,
                supportsVision: false,
              },
            ]
          : undefined,
      );

      const mockStream = async function* () {
        yield { choices: [{ delta: { content: "done" } }] };
      };
      (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as unknown as vscode.CancellationToken;
      const model = {
        id: modelId,
        maxInputTokens: 100000,
        maxOutputTokens: 65536,
      } as vscode.LanguageModelChatInformation;
      const requestMessages = [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart("Inspect the workspace")],
        },
      ] as unknown as vscode.LanguageModelChatMessage[];
      const requestOptions = {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as unknown as vscode.ProvideLanguageModelChatResponseOptions;

      await provider.provideLanguageModelChatResponse(
        model,
        requestMessages,
        requestOptions,
        progress,
        token,
      );

      const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];

      expect(requestBody.temperature).toBe(expectedTemperature);
      expect(requestBody.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining(expectedMessageSnippet),
          }),
        ]),
      );
    },
  );

  it("preserves text order around a text-embedded tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                'Before <|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"/tmp/example.md"}<|tool_call_end|> after',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    expect(progress.report.mock.calls).toHaveLength(3);
    expect(progress.report.mock.calls[0][0]).toEqual(expect.objectContaining({ value: "Before " }));
    expect(progress.report.mock.calls[1][0]).toEqual(
      expect.objectContaining({ name: "read_file" }),
    );
    expect(progress.report.mock.calls[2][0]).toEqual(expect.objectContaining({ value: " after" }));
  });

  it("emits a tool call when text-embedded control tokens are split across chunks", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"/tmp/exa',
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              content: 'mple.md"}<|tool_call_end|>',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
    expect(textReports).toHaveLength(0);
  });

  it("repairs empty read_file arguments from editor context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 158 to line 158.\n</editorContext>\n<userRequest>ツールを使ってファイルを読み込んでみてください</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 158,
      endLine: 158,
    });
  });

  it("repairs missing read_file line arguments from editor context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: '{"filePath":"/tmp/example.md"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 42 to line 45.\n</editorContext>\n<userRequest>Read the current selection</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 42,
      endLine: 45,
    });
  });

  it("does not inject selection lines when read_file line arguments are optional", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: '{"filePath":"/tmp/example.md"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 42 to line 45.\n</editorContext>\n<userRequest>Read the whole file</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
  });

  it("repairs read_file with the current file path even when no selection lines are provided", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<context>\nCwd: /tmp/workspace\n</context>\n<editorContext>\nThe user's current file is /tmp/example.md. \n</editorContext>\n<userRequest>Read the open file</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
              },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
  });

  it("defaults read_file line arguments when the schema requires a range but chat only provides the current file", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<context>\nCwd: /tmp/workspace\n</context>\n<editorContext>\nThe user's current file is /tmp/example.md. \n</editorContext>\n<userRequest>Check the current file</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 1,
      endLine: 200,
    });
  });

  it("repairs list_dir with the current working directory from chat context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "list_dir:0",
                  type: "function",
                  function: { name: "list_dir", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<context>\nCwd: /tmp/workspace\n</context>\n<userRequest>List files in the current directory</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List files in a directory",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("list_dir");
    expect(toolCallReports[0][0].input).toEqual({ path: "/tmp/workspace" });
  });

  it("waits for later streamed arguments before validating a tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "grep_search:0",
                  type: "function",
                  function: { name: "grep_search" },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"query":"causal","isRegexp":false}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Test the memory tool" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "grep_search",
            description: "Search notes by text",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                },
                isRegexp: {
                  type: "boolean",
                  description: "Whether query is a regular expression",
                },
              },
              required: ["query", "isRegexp"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("grep_search");
    expect(toolCallReports[0][0].input).toEqual({ query: "causal", isRegexp: false });
  });

  it("repairs text-embedded read_file arguments from editor context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                "<|tool_call_begin|>read_file<|tool_call_argument_begin|>{}<|tool_call_end|>",
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 10 to line 12.\n</editorContext>\n<userRequest>Read the selected lines</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 10,
      endLine: 12,
    });
  });

  it("suppresses an immediate duplicate of the just-completed tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":158,"endLine":158}',
                  },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 2,
          content: [
            new (vscode as any).LanguageModelToolCallPart("read_file:0", "read_file", {
              filePath: "/tmp/example.md",
              startLine: 158,
              endLine: 158,
            }),
          ],
        },
        {
          role: 1,
          content: [
            new (vscode as any).LanguageModelToolResultPart("read_file:0", [
              new (vscode as any).LanguageModelTextPart("**③ パネル・データ分析（差分の差分法）**"),
            ]),
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(0);
  });

  it("allows the same tool call again after an intervening user message", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":158,"endLine":158}',
                  },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 2,
          content: [
            new (vscode as any).LanguageModelToolCallPart("read_file:0", "read_file", {
              filePath: "/tmp/example.md",
              startLine: 158,
              endLine: 158,
            }),
          ],
        },
        {
          role: 1,
          content: [
            new (vscode as any).LanguageModelToolResultPart("read_file:0", [
              new (vscode as any).LanguageModelTextPart("**③ パネル・データ分析（差分の差分法）**"),
            ]),
          ],
        },
        {
          role: 1,
          content: [new (vscode as any).LanguageModelTextPart("Read that same line again.")],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0]).toEqual(
      expect.objectContaining({ callId: "read_file:1", name: "read_file" }),
    );
  });

  it("sends non-empty reasoning_content for assistant tool call history", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 2,
          content: [
            new (vscode as any).LanguageModelTextPart("Let me check"),
            new (vscode as any).LanguageModelToolCallPart("call_1", "get_weather", {
              city: "Tokyo",
            }),
          ],
        },
        {
          role: 1,
          content: [
            new (vscode as any).LanguageModelToolResultPart("call_1", [
              new (vscode as any).LanguageModelTextPart("Sunny, 25C"),
            ]),
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];
    expect(requestBody).toBeDefined();
    expect(requestBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: " ",
          tool_calls: expect.any(Array),
        }),
      ]),
    );
  });
});

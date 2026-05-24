import { OcGoMcpClient } from "../src/mcp-compat";

describe("OcGoMcpClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the NVIDIA NIM API key from secret storage", async () => {
    const secrets = {
      get: jest.fn(async () => undefined),
    };
    const client = new OcGoMcpClient(secrets as never);

    await expect(client.analyzeImage("data:image/png;base64,abc", "What is this?")).rejects.toThrow(
      "NVIDIA NIM API key not found",
    );
    expect(secrets.get).toHaveBeenCalledWith("nvidia-nim.apiKey");
  });

  it("uses the cached NVIDIA vision model for image analysis", async () => {
    const secrets = {
      get: jest.fn(async () => "test-key"),
    };
    const modelStorage = {
      get: jest.fn(() => [
        {
          id: "nvidia/vision-model",
          displayName: "NVIDIA Vision Model",
          vendor: "nvidia",
          family: "vision",
          contextWindow: 100000,
          maxOutputTokens: 8192,
          supportsTools: true,
          supportsVision: true,
        },
      ]),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Image analysis" } }] }),
    } as any);
    const client = new OcGoMcpClient(secrets as never, modelStorage as never);

    const result = await client.analyzeImage("data:image/png;base64,abc", "What is this?");

    expect(result).toBe("Image analysis");
    expect(fetch).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining('"model":"nvidia/vision-model"'),
      }),
    );
  });

  it("uses apiKeyOverride when provided", async () => {
    const secrets = {
      get: jest.fn(async () => "stored-key"),
    };
    const modelStorage = {
      get: jest.fn(() => [
        {
          id: "nvidia/vision-model",
          displayName: "NVIDIA Vision Model",
          vendor: "nvidia",
          family: "vision",
          contextWindow: 100000,
          maxOutputTokens: 8192,
          supportsTools: true,
          supportsVision: true,
        },
      ]),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Image analysis" } }] }),
    } as any);
    const client = new OcGoMcpClient(secrets as never, modelStorage as never);

    const result = await client.analyzeImage(
      "data:image/png;base64,abc",
      "What is this?",
      undefined,
      "custom-key-override",
    );

    expect(result).toBe("Image analysis");
    expect(secrets.get).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer custom-key-override",
        }),
      }),
    );
  });

  it("aborts fetch when cancellation signal is triggered", async () => {
    const secrets = {
      get: jest.fn(async () => "test-key"),
    };
    const modelStorage = {
      get: jest.fn(() => [
        {
          id: "nvidia/vision-model",
          displayName: "NVIDIA Vision Model",
          vendor: "nvidia",
          family: "vision",
          contextWindow: 100000,
          maxOutputTokens: 8192,
          supportsTools: true,
          supportsVision: true,
        },
      ]),
    };
    const controller = new AbortController();
    global.fetch = jest.fn().mockImplementation((_url, options) => {
      if (options.signal) {
        if (options.signal.aborted) {
          return Promise.reject(new Error("aborted"));
        }
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Image analysis" } }] }),
      });
    });
    const client = new OcGoMcpClient(secrets as never, modelStorage as never);

    const promise = client.analyzeImage(
      "data:image/png;base64,abc",
      "What is this?",
      controller.signal,
    );
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it("does not fall back to a hardcoded vision model when cache has no vision model", async () => {
    const secrets = {
      get: jest.fn(async () => "test-key"),
    };
    const modelStorage = {
      get: jest.fn(() => []),
    };
    global.fetch = jest.fn();
    const client = new OcGoMcpClient(secrets as never, modelStorage as never);

    await expect(client.analyzeImage("data:image/png;base64,abc", "What is this?")).rejects.toThrow(
      "No NVIDIA NIM vision model is available",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

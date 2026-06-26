import { fetchModels, streamChatCompletion } from "../src/api";
import { STREAM_IDLE_TIMEOUT_MS } from "../src/constants";
import { NvidiaModelSummary, NvidiaNimStreamResponse } from "../src/types";

const rawModelSummaries: NvidiaModelSummary[] = [
  {
    id: "meta/llama-4-maverick-17b-128e-instruct",
    name: "Llama 4 Maverick 17B 128E Instruct",
    capabilities: {
      chat: true,
      vision: true,
      tool_calling: true,
    },
    metadata: {
      context_window: 262144,
      max_output_tokens: 8192,
    },
  },
];

describe("fetchModels", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns raw NVIDIA model summaries on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: rawModelSummaries }),
    } as any);

    const result = await fetchModels("test-key");
    expect(result).toEqual(rawModelSummaries);
    expect(result?.[0]).toEqual(
      expect.objectContaining({
        id: "meta/llama-4-maverick-17b-128e-instruct",
        capabilities: expect.objectContaining({ vision: true, tool_calling: true }),
        metadata: expect.objectContaining({ context_window: 262144, max_output_tokens: 8192 }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });

  it("returns null on failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid key",
    } as any);

    const result = await fetchModels("bad-key");
    expect(result).toBeNull();
  });

  it("retries on network failure and succeeds", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: rawModelSummaries }),
      } as any);

    const result = await fetchModels("test-key");
    expect(result).toEqual(rawModelSummaries);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times then returns null", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchModels("test-key");
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 with Retry-After then succeeds", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name === "retry-after" ? "1" : null) },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: rawModelSummaries }),
      } as any);

    const result = await fetchModels("test-key");
    expect(result).toEqual(rawModelSummaries);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 then succeeds", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: { get: () => null },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: rawModelSummaries }),
      } as any);

    const result = await fetchModels("test-key");
    expect(result).toEqual(rawModelSummaries);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("parses Retry-After as HTTP-date format", async () => {
    const retryDate = new Date(Date.now() + 100).toUTCString();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": retryDate }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: rawModelSummaries }),
      } as any);

    const result = await fetchModels("test-key");
    expect(result).toEqual(rawModelSummaries);
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it("falls back to exponential backoff when Retry-After is unparseable", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "not-a-number" }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: rawModelSummaries }),
      } as any);

    const result = await fetchModels("test-key");
    expect(result).toEqual(rawModelSummaries);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401 and returns null immediately", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid key",
    } as any);

    const result = await fetchModels("bad-key");
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("streamChatCompletion", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).fetch;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("yields parsed SSE chunks", async () => {
    const chunk: NvidiaNimStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k2.6",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
    const results: NvidiaNimStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("throws on non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server error",
    } as any);

    const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow("[SERVER_ERROR] Server error.");
  });

  it("throws authentication error on 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid key",
    } as any);

    const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow(
      "[AUTH_FAILED] Authentication failed. Your API key may be invalid or expired.",
    );
  });

  it("retries on 429 and eventually throws after exhausting retries", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: (name: string) => (name === "retry-after" ? "0" : null) },
      text: async () => "Rate limited",
    } as any);

    const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow("HTTP 429");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("handles partial lines across chunks", async () => {
    const chunk: NvidiaNimStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k2.6",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const jsonStr = JSON.stringify(chunk);
    const part1 = `data: ${jsonStr.slice(0, 10)}`;
    const part2 = `${jsonStr.slice(10)}\n\n`;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
    const results: NvidiaNimStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("skips malformed JSON lines", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid json}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
    const results: NvidiaNimStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });

  it("uses dynamic idle timeout based on maxOutputTokens", async () => {
    const chunk: NvidiaNimStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k2.6",
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion(
      "test-key",
      {
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        max_tokens: 100,
        temperature: 0,
      },
      new AbortController().signal,
      "test-agent",
      { maxOutputTokens: 500 },
    );

    for await (const _ of gen) {
      // consume
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels the reader when the stream idle timeout elapses", async () => {
    jest.useFakeTimers();

    try {
      const cancel = jest.fn().mockResolvedValue(undefined);
      const reader = {
        read: jest.fn(() => new Promise(() => undefined)),
        cancel,
        releaseLock: jest.fn(),
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => reader,
        },
      } as any);

      const gen = streamChatCompletion("key", { model: "kimi-k2.6", messages: [], stream: true });
      const nextPromise = gen.next();
      const rejection = expect(nextPromise).rejects.toThrow(
        "NVIDIA NIM streaming timeout: no data received",
      );

      await jest.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);

      await rejection;
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

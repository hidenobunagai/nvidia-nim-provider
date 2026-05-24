import { isNormalizedNvidiaModel, normalizeNvidiaModels } from "../src/model-catalog";
import type { NvidiaModelSummary } from "../src/types";

describe("normalizeNvidiaModels", () => {
  it("keeps chat models and infers tool and vision support from explicit capabilities", () => {
    const raw: NvidiaModelSummary[] = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        capabilities: { chat: true, vision: true, tool_calling: true },
        metadata: { context_window: 128000 },
      },
      {
        id: "nvidia/nv-embedqa-e5-v5",
        capabilities: { chat: false },
      },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([
      expect.objectContaining({
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "Llama 4 Maverick 17B 128E Instruct",
        supportsVision: true,
        supportsTools: true,
        contextWindow: 128000,
      }),
    ]);
  });

  it("assumes chat models can use tools when the API omits capability metadata", () => {
    const raw: NvidiaModelSummary[] = [
      {
        id: "meta/llama-3.1-8b-instruct",
      },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([
      {
        id: "meta/llama-3.1-8b-instruct",
        displayName: "llama-3.1-8b-instruct",
        contextWindow: 128000,
        maxOutputTokens: 65536,
        supportsTools: true,
        supportsVision: false,
      },
    ]);
  });

  it("uses model-card context windows for known NVIDIA overrides", () => {
    const raw: NvidiaModelSummary[] = [
      { id: "meta/llama-3.1-70b-instruct" },
      { id: "deepseek-ai/deepseek-v4-flash" },
      { id: "deepseek-ai/deepseek-v4-pro" },
      { id: "moonshotai/kimi-k2.5" },
      { id: "moonshotai/kimi-k2.6" },
      { id: "z-ai/glm4.7" },
      { id: "z-ai/glm5.1" },
      { id: "microsoft/phi-4-mini-instruct" },
      { id: "openai/gpt-oss-120b" },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([
      expect.objectContaining({
        id: "meta/llama-3.1-70b-instruct",
        contextWindow: 128000,
      }),
      expect.objectContaining({
        id: "deepseek-ai/deepseek-v4-flash",
        contextWindow: 1000000,
      }),
      expect.objectContaining({
        id: "deepseek-ai/deepseek-v4-pro",
        contextWindow: 1000000,
      }),
      expect.objectContaining({
        id: "moonshotai/kimi-k2.5",
        contextWindow: 262144,
      }),
      expect.objectContaining({
        id: "moonshotai/kimi-k2.6",
        contextWindow: 262144,
      }),
      expect.objectContaining({
        id: "z-ai/glm4.7",
        contextWindow: 131072,
      }),
      expect.objectContaining({
        id: "z-ai/glm5.1",
        contextWindow: 131072,
      }),
      expect.objectContaining({
        id: "microsoft/phi-4-mini-instruct",
        contextWindow: 128000,
      }),
      expect.objectContaining({
        id: "openai/gpt-oss-120b",
        contextWindow: 128000,
      }),
    ]);
  });

  it("uses metadata.max_tokens when max_output_tokens is absent", () => {
    const raw: NvidiaModelSummary[] = [
      {
        id: "meta/llama-3.1-8b-instruct",
        metadata: { max_tokens: 8192 },
      },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([
      expect.objectContaining({
        id: "meta/llama-3.1-8b-instruct",
        maxOutputTokens: 8192,
      }),
    ]);
  });

  it("prefers the API name over a known override display name", () => {
    const raw: NvidiaModelSummary[] = [
      {
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "API Supplied Llama 4 Maverick",
      },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([
      expect.objectContaining({
        id: "meta/llama-4-maverick-17b-128e-instruct",
        displayName: "API Supplied Llama 4 Maverick",
      }),
    ]);
  });

  it("filters obvious non-chat models when chat capability metadata is absent", () => {
    const raw: NvidiaModelSummary[] = [
      { id: "baai/bge-m3" },
      { id: "nvidia/ai-synthetic-video-detector" },
      { id: "nvidia/nemoretriever-parse" },
      { id: "nvidia/nv-embedqa-e5-v5" },
      { id: "nv-rerank-qa-mistral-4b:1" },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([]);
  });

  it("deduplicates exact duplicate model ids from the NVIDIA catalog", () => {
    const raw: NvidiaModelSummary[] = [
      { id: "openai/gpt-oss-120b" },
      { id: "openai/gpt-oss-120b" },
    ];

    expect(normalizeNvidiaModels(raw)).toEqual([
      expect.objectContaining({
        id: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        contextWindow: 128000,
      }),
    ]);
  });

  it("detects whether cached values match the normalized NVIDIA model shape", () => {
    expect(
      isNormalizedNvidiaModel({
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        contextWindow: 262144,
        maxOutputTokens: 262144,
        supportsTools: true,
        supportsVision: true,
      }),
    ).toBe(true);
    expect(
      isNormalizedNvidiaModel({
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        contextWindow: 262144,
        maxOutputTokens: "262144",
        supportsTools: true,
        supportsVision: true,
      }),
    ).toBe(false);
  });
});

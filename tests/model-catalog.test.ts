import {
  findPreferredVisionModel,
  isNormalizedNvidiaModel,
  normalizeNvidiaModels,
} from "../src/model-catalog";
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
        displayName: "Llama 3.1 8B Instruct",
        contextWindow: 131072,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsVision: false,
      },
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
      { id: "bigcode/starcoder2-15b" },
      { id: "google/codegemma-1.1-7b" },
      { id: "google/diffusiongemma-26b-a4b-it" },
      { id: "google/gemma-2b" },
      { id: "google/recurrentgemma-2b" },
      { id: "meta/codellama-70b" },
      { id: "meta/llama-guard-4-12b" },
      { id: "meta/llama2-70b" },
      { id: "nvidia/ai-synthetic-video-detector" },
      { id: "nvidia/ising-calibration-1.5-31b" },
      { id: "nvidia/llama-3.1-nemoguard-8b-content-safety" },
      { id: "nvidia/llama-3.1-nemoguard-8b-topic-control" },
      { id: "nvidia/llama-3.1-nemotron-safety-guard-8b-v3" },
      { id: "nvidia/nemotron-3.5-content-safety" },
      { id: "nvidia/nemoretriever-parse" },
      { id: "nvidia/nv-embedqa-e5-v5" },
      { id: "nvidia/nvclip" },
      { id: "nvidia/riva-translate-4b-instruct" },
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
        displayName: "GPT-OSS 120B",
      }),
    ]);
  });

  it("applies known metadata overrides when the API omits capabilities", () => {
    const raw: NvidiaModelSummary[] = [
      { id: "moonshotai/kimi-k2.6" },
      { id: "meta/llama-3.2-11b-vision-instruct" },
      { id: "nvidia/llama-3.1-nemotron-nano-vl-8b-v1" },
      { id: "deepseek-ai/deepseek-v4-flash-0731" },
      { id: "nvidia/nemotron-3-ultra-550b-a55b" },
    ];

    const models = normalizeNvidiaModels(raw);
    expect(models).toEqual([
      expect.objectContaining({
        id: "moonshotai/kimi-k2.6",
        displayName: "Kimi K2.6",
        contextWindow: 262144,
        supportsVision: true,
      }),
      expect.objectContaining({
        id: "meta/llama-3.2-11b-vision-instruct",
        displayName: "Llama 3.2 11B Vision Instruct",
        supportsVision: true,
      }),
      expect.objectContaining({
        id: "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
        displayName: "Llama 3.1 Nemotron Nano VL 8B V1",
        supportsVision: true,
      }),
      expect.objectContaining({
        id: "deepseek-ai/deepseek-v4-flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        contextWindow: 1000000,
      }),
      expect.objectContaining({
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        displayName: "Nemotron 3 Ultra 550B A55B",
      }),
    ]);
  });

  it("marks known non-tool VLMs as non-tool-capable", () => {
    const raw: NvidiaModelSummary[] = [
      { id: "adept/fuyu-8b" },
      { id: "google/deplot" },
      { id: "microsoft/kosmos-2" },
    ];

    const models = normalizeNvidiaModels(raw);
    expect(models).toHaveLength(3);
    for (const model of models) {
      expect(model.supportsVision).toBe(true);
      expect(model.supportsTools).toBe(false);
    }
  });

  it("prefers modern vision models for the image fallback", () => {
    const models = normalizeNvidiaModels([
      { id: "adept/fuyu-8b" },
      { id: "meta/llama-3.2-11b-vision-instruct" },
      { id: "nvidia/nemotron-nano-12b-v2-vl" },
      { id: "openai/gpt-oss-120b" },
    ]);

    expect(findPreferredVisionModel(models)?.id).toBe("meta/llama-3.2-11b-vision-instruct");
    expect(
      findPreferredVisionModel(
        normalizeNvidiaModels([{ id: "adept/fuyu-8b" }, { id: "microsoft/kosmos-2" }]),
      )?.id,
    ).toBe("adept/fuyu-8b");
    expect(findPreferredVisionModel(normalizeNvidiaModels([{ id: "openai/gpt-oss-120b" }]))).toBe(
      undefined,
    );
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

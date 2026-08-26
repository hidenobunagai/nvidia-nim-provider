import { MODELS_CACHE_VERSION, THINKING_MODELS } from "../src/constants";

describe("THINKING_MODELS", () => {
  it.each([
    "deepseek-ai/deepseek-r1",
    "deepseek-ai/deepseek-v4-flash-0731",
    "deepseek-ai/deepseek-v4-pro",
    "moonshotai/kimi-k2.6",
    "moonshotai/kimi-k2-thinking",
    "moonshotai/kimi-k3",
    "z-ai/glm-5.2",
    "zai-org/glm-5.2",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "minimaxai/minimax-m3",
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "nvidia/cosmos-reason2-8b",
    "qwen/qwq-32b-preview",
  ])("recognizes %s as a thinking model", (modelId) => {
    expect(THINKING_MODELS.has(modelId)).toBe(true);
  });

  it.each([
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-8b-instruct",
    "openai/gpt-4o",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "mistralai/mistral-nemotron",
    "google/gemma-4-31b-it",
    "meta/muse-glimmer-30b",
  ])("does not treat %s as a thinking model", (modelId) => {
    expect(THINKING_MODELS.has(modelId)).toBe(false);
  });
});

describe("MODELS_CACHE_VERSION", () => {
  it("is the current cache schema version", () => {
    expect(MODELS_CACHE_VERSION).toBe(6);
  });
});

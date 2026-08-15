import { getModelAdapter } from "../src/adapters";

describe("getModelAdapter", () => {
  it.each([
    ["kimi-k2.6", 0.2, 0.1, "Do not reveal chain-of-thought"],
    ["zai-org/glm-4.5", 0.1, 0.05, "strict JSON arguments"],
    ["meta/llama-4-maverick-17b-128e-instruct", 0.2, 0.1, "Do not emit pseudo tool syntax"],
    ["minimaxai/minimax-m3", 0.6, 0.4, "complete JSON arguments"],
    ["mistralai/codestral-22b-instruct-v0.1", 0.3, 0.2, "Do not include disclaimers"],
  ])(
    "returns a specialized tool-enabled profile for %s",
    (
      modelId: string,
      expectedDefaultTemperature: number,
      expectedToolTemperature: number,
      expectedMessageSnippet: string,
    ) => {
      const adapter = getModelAdapter(modelId);
      const profile = adapter.getProfile({ toolsEnabled: true });

      expect(profile.defaultTemperature).toBe(expectedDefaultTemperature);
      expect(profile.toolTemperature).toBe(expectedToolTemperature);
      expect(profile.extraSystemMessages).toEqual(
        expect.arrayContaining([expect.stringContaining(expectedMessageSnippet)]),
      );
    },
  );

  it("does not add extra system guidance when tools are disabled", () => {
    const adapter = getModelAdapter("kimi-k2.6");
    const profile = adapter.getProfile({ toolsEnabled: false });

    expect(profile.defaultTemperature).toBe(0.2);
    expect(profile.extraSystemMessages).toEqual([]);
  });

  it("falls back to the default profile for unknown models", () => {
    const adapter = getModelAdapter("unknown-model");
    const profile = adapter.getProfile({ toolsEnabled: true });

    expect(profile.defaultTemperature).toBe(0.7);
    expect(profile.extraSystemMessages).toEqual([
      "You are an expert AI programming assistant. Provide correct, concise, production-ready code. Prefer simple solutions. Analyze the problem before coding. When tools are available, answer with concise user-facing text or a valid tool call. Do not include disclaimers or apologies.",
    ]);
  });

  it("does not add extra system guidance when tools are disabled for unknown models", () => {
    const adapter = getModelAdapter("unknown-model");
    const profile = adapter.getProfile({ toolsEnabled: false });

    expect(profile.defaultTemperature).toBe(0.7);
    expect(profile.extraSystemMessages).toEqual([]);
  });
});

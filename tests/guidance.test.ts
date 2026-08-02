import {
  applyOpenAiSystemPromptGuidance,
  buildProviderIdentityGuidance,
  buildToolUseGroundingGuidance,
  sanitizeSystemPromptForModel,
} from "../src/guidance";
import { NvidiaNimChatMessage } from "../src/types";

describe("sanitizeSystemPromptForModel", () => {
  it("returns undefined for undefined input", () => {
    expect(sanitizeSystemPromptForModel(undefined, "deepseek-ai/deepseek-r1")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(sanitizeSystemPromptForModel("", "deepseek-ai/deepseek-r1")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(sanitizeSystemPromptForModel("   ", "deepseek-ai/deepseek-r1")).toBeUndefined();
  });

  it("returns original string for non-deepseek model", () => {
    const prompt = "You are Claude, an AI assistant.";
    expect(sanitizeSystemPromptForModel(prompt, "meta/llama-4-maverick-17b-128e-instruct")).toBe(
      prompt,
    );
  });

  it('replaces "Claude" with "GitHub Copilot" for deepseek models (word boundary)', () => {
    const prompt = "You are Claude, an AI assistant from Anthropic.";
    expect(sanitizeSystemPromptForModel(prompt, "deepseek-ai/deepseek-r1")).toBe(
      "You are GitHub Copilot, an AI assistant from NVIDIA NIM.",
    );
  });
});

describe("buildProviderIdentityGuidance", () => {
  it("mentions GitHub Copilot, NVIDIA NIM, and the model id", () => {
    const guidance = buildProviderIdentityGuidance("deepseek-ai/deepseek-r1");
    expect(guidance).toContain("GitHub Copilot");
    expect(guidance).toContain("NVIDIA NIM");
    expect(guidance).toContain("deepseek-ai/deepseek-r1");
  });
});

describe("buildToolUseGroundingGuidance", () => {
  it("returns undefined when no tools are available", () => {
    expect(buildToolUseGroundingGuidance({ tools: [] } as never)).toBeUndefined();
  });

  it("returns guidance when tools are available", () => {
    const guidance = buildToolUseGroundingGuidance({ tools: [{}] } as never);
    expect(guidance).toContain("emit the tool call directly");
    expect(guidance).toContain("Never end your response by announcing an action");
    expect(guidance).toContain("parallel");
  });
});

describe("applyOpenAiSystemPromptGuidance", () => {
  const messages: NvidiaNimChatMessage[] = [
    { role: "system", content: "You are Claude, an AI assistant from Anthropic." },
    { role: "user", content: "Inspect the workspace" },
  ];

  it("returns messages unchanged when no tools and non-deepseek model", () => {
    const result = applyOpenAiSystemPromptGuidance(
      messages,
      "meta/llama-4-maverick-17b-128e-instruct",
      {
        tools: [],
      } as never,
    );
    expect(result).toEqual(messages);
  });

  it("appends identity guidance to the first system message for deepseek models", () => {
    const result = applyOpenAiSystemPromptGuidance(messages, "deepseek-ai/deepseek-r1", {
      tools: [],
    } as never);
    expect(result[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("You are GitHub Copilot using the NVIDIA NIM provider"),
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        content: expect.not.stringContaining("Anthropic"),
      }),
    );
  });

  it("appends tool-use grounding guidance when tools are available", () => {
    const result = applyOpenAiSystemPromptGuidance(
      messages,
      "meta/llama-4-maverick-17b-128e-instruct",
      {
        tools: [{ name: "read_file" }],
      } as never,
    );
    const systemContent = result[0]?.content;
    expect(typeof systemContent).toBe("string");
    expect(systemContent).toContain("Never end your response by announcing an action");
  });

  it("prepends a system message when none exists", () => {
    const result = applyOpenAiSystemPromptGuidance(
      [{ role: "user", content: "Hello" }],
      "deepseek-ai/deepseek-r1",
      { tools: [{ name: "read_file" }] } as never,
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("NVIDIA NIM"),
      }),
    );
  });
});

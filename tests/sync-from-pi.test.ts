import { syncCatalog } from "../scripts/sync-from-pi";
import type { PiModel } from "../scripts/sync-from-pi";

function pi(id: string, ctx: number, max: number, vision: boolean): PiModel {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    reasoning: false,
    input: vision ? ["text", "image"] : ["text"],
    contextWindow: ctx,
    maxTokens: max,
  };
}

const FIXTURE = `export const KNOWN_MODEL_OVERRIDES: Record<string, Partial<NormalizedNvidiaModel>> = {
  "deepseek-ai/deepseek-v4-flash-0731": {
    displayName: "DeepSeek V4 Flash 0731",
    contextWindow: 131072,
  },
  "google/gemma-3-4b-it": {
    displayName: "Gemma 3 4B IT",
  },
  "meta/llama-3.3-nemotron-super-49b-v1": {
    displayName: "Llama 3.3 Nemotron Super 49B V1",
    contextWindow: 131072,
    maxOutputTokens: 131072,
    supportsVision: false,
  },
  "only/ours": {
    displayName: "Only Ours",
  },
};
`;

describe("syncCatalog", () => {
  it("replaces existing fields, inserts missing ones, leaves matches and unknown ids untouched", () => {
    const piMap = new Map<string, PiModel>([
      [
        "deepseek-ai/deepseek-v4-flash-0731",
        pi("deepseek-ai/deepseek-v4-flash-0731", 1000000, 384000, false),
      ],
      // contextWindow differs from the 131072 default, so the missing field is inserted
      ["google/gemma-3-4b-it", pi("google/gemma-3-4b-it", 262144, 16384, true)],
      [
        "meta/llama-3.3-nemotron-super-49b-v1",
        pi("meta/llama-3.3-nemotron-super-49b-v1", 131072, 131072, false),
      ],
      ["pi/only-model", pi("pi/only-model", 8192, 4096, false)],
    ]);

    const { out, diffs, changed, piOnly, overrideOnly } = syncCatalog(FIXTURE, piMap);

    expect(diffs).toEqual([
      "deepseek-ai/deepseek-v4-flash-0731: contextWindow 131072 -> 1000000",
      "deepseek-ai/deepseek-v4-flash-0731: maxOutputTokens 65536 -> 384000",
      "google/gemma-3-4b-it: contextWindow 131072 -> 262144",
      "google/gemma-3-4b-it: maxOutputTokens 65536 -> 16384",
      "google/gemma-3-4b-it: supportsVision false -> true",
    ]);
    expect(changed).toBe(5);
    expect(piOnly).toEqual(["pi/only-model"]);
    expect(overrideOnly).toBe(1);

    // deepseek: replaced contextWindow + inserted maxOutputTokens
    expect(out).toContain(
      '"deepseek-ai/deepseek-v4-flash-0731": {\n    displayName: "DeepSeek V4 Flash 0731",\n    contextWindow: 1000000,\n    maxOutputTokens: 384000,',
    );
    // gemma: contextWindow/maxOutputTokens/supportsVision all inserted after displayName
    expect(out).toContain(
      'displayName: "Gemma 3 4B IT",\n    contextWindow: 262144,\n    maxOutputTokens: 16384,\n    supportsVision: true,',
    );
    // unchanged entry keeps its fields
    expect(out).toContain(
      '"meta/llama-3.3-nemotron-super-49b-v1": {\n    displayName: "Llama 3.3 Nemotron Super 49B V1",\n    contextWindow: 131072,\n    maxOutputTokens: 131072,\n    supportsVision: false,',
    );
  });

  it("keeps the entry order and is idempotent", () => {
    const piMap = new Map<string, PiModel>([
      [
        "deepseek-ai/deepseek-v4-flash-0731",
        pi("deepseek-ai/deepseek-v4-flash-0731", 1000000, 384000, false),
      ],
      ["google/gemma-3-4b-it", pi("google/gemma-3-4b-it", 131072, 16384, true)],
    ]);

    const first = syncCatalog(FIXTURE, piMap);
    const second = syncCatalog(first.out, piMap);

    expect(second.diffs).toEqual([]);
    expect(second.out).toBe(first.out);
    expect(second.changed).toBe(0);

    const ids = [
      "deepseek-ai/deepseek-v4-flash-0731",
      "google/gemma-3-4b-it",
      "meta/llama-3.3-nemotron-super-49b-v1",
      "only/ours",
    ];
    let last = -1;
    for (const id of ids) {
      const idx = first.out.indexOf(`"${id}"`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("respects the ignored map", () => {
    const piMap = new Map<string, PiModel>([
      [
        "deepseek-ai/deepseek-v4-flash-0731",
        pi("deepseek-ai/deepseek-v4-flash-0731", 1000000, 384000, false),
      ],
    ]);

    const { diffs, changed } = syncCatalog(FIXTURE, piMap, {
      ignored: { "deepseek-ai/deepseek-v4-flash-0731": ["maxOutputTokens"] },
    });

    expect(diffs).toEqual(["deepseek-ai/deepseek-v4-flash-0731: contextWindow 131072 -> 1000000"]);
    expect(changed).toBe(1);
  });
});

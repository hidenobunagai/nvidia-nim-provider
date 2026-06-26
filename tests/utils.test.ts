import * as vscode from "vscode";
import { NvidiaNimChatMessage } from "../src/types";
import { convertMessages, convertTools } from "../src/openai-conversion";
import { estimateMessagesTokens, estimateTokens } from "../src/tokenizer";
import { filterThinkTagsFromChunk, stripThinkTags } from "../src/utils";

describe("convertMessages", () => {
  it("converts user text message", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Hello")],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toEqual<NvidiaNimChatMessage[]>([{ role: "user", content: "Hello" }]);
  });

  it("converts assistant text message", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.Assistant,
        content: [new vscode.LanguageModelTextPart("Hi there")],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toEqual<NvidiaNimChatMessage[]>([{ role: "assistant", content: "Hi there" }]);
  });

  it("converts system text message", () => {
    const messages = [
      {
        role: (vscode as any).LanguageModelChatMessageRole.System,
        content: [new vscode.LanguageModelTextPart("Be helpful")],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toEqual<NvidiaNimChatMessage[]>([{ role: "system", content: "Be helpful" }]);
  });

  it("handles empty messages", () => {
    const messages = [{ role: vscode.LanguageModelChatMessageRole.User, content: [] }];
    const result = convertMessages(messages as any);
    expect(result).toEqual<NvidiaNimChatMessage[]>([{ role: "user", content: "" }]);
  });

  it("converts image parts to image_url for vision-capable models", () => {
    const imageData = new Uint8Array([1, 2, 3]);
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [{ mimeType: "image/png", data: imageData }],
      },
    ];
    const result = convertMessages(messages as any, { supportsVision: true });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    const content = result[0].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(content[0].type).toBe("image_url");
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  it("does not convert image parts when vision is not supported", () => {
    const imageData = new Uint8Array([1, 2, 3]);
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelTextPart("Describe this image"),
          { mimeType: "image/png", data: imageData },
        ],
      },
    ];
    const result = convertMessages(messages as any, { supportsVision: false });
    expect(result).toEqual<NvidiaNimChatMessage[]>([{ role: "user", content: "Describe this image" }]);
  });
});

describe("estimateTokens", () => {
  it("estimates tokens for ASCII text", () => {
    expect(estimateTokens("Hello world")).toBeGreaterThan(0);
  });
});

describe("estimateMessagesTokens", () => {
  it("estimates tokens for multiple messages", () => {
    const messages = [
      { content: [new vscode.LanguageModelTextPart("Hello")] },
      { content: [new vscode.LanguageModelTextPart("world")] },
    ];
    expect(estimateMessagesTokens(messages as any)).toBe(
      estimateTokens("Hello") + estimateTokens("world"),
    );
  });
});

describe("convertTools", () => {
  it("returns empty object when no tools", () => {
    const result = convertTools({ tools: [] } as any);
    expect(result).toEqual({});
  });

  it("converts VS Code tools to NVIDIA NIM format", () => {
    const result = convertTools({
      tools: [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    } as any);
    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0].type).toBe("function");
    expect(result.tools?.[0].function.name).toBe("test_tool");
  });

  it("augments tool descriptions with required parameter guidance", () => {
    const result = convertTools({
      tools: [
        {
          name: "read_file",
          description: "Read a file from disk",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Absolute path to the file" },
              offset: { type: "number" },
            },
            required: ["filePath"],
          },
        },
      ],
    } as any);
    expect(result.tools).toHaveLength(1);
    const description = result.tools?.[0].function.description ?? "";
    expect(description).toContain("Required arguments");
    expect(description).toContain("filePath");
    expect(description).toContain("Return a valid JSON object");
  });

  it("includes enum choices for required string arguments", () => {
    const result = convertTools({
      tools: [
        {
          name: "memory",
          description: "Manage persistent memory",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                enum: ["view", "create", "str_replace", "insert", "delete", "rename"],
                description: "Memory operation to perform",
              },
              path: {
                type: "string",
                description: "Target memory path",
              },
            },
            required: ["command"],
          },
        },
      ],
    } as any);

    const description = result.tools?.[0].function.description ?? "";
    expect(description).toContain("command");
    expect(description).toContain("Required arguments");
    expect(description).toContain("Allowed values");
    expect(description).toContain("view");
    expect(description).toContain("create");
  });
});

describe("convertMessages with tools", () => {
  it("converts tool call parts", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.Assistant,
        content: [
          new vscode.LanguageModelTextPart("Let me check"),
          new vscode.LanguageModelToolCallPart("call_1", "get_weather", { city: "Tokyo" }),
        ],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].reasoning_content).toBe(" ");
    expect(result[0].tool_calls).toHaveLength(1);
    expect(result[0].tool_calls?.[0].function.name).toBe("get_weather");
  });

  it("converts tool result parts", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            new vscode.LanguageModelTextPart("Sunny, 25C"),
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].tool_call_id).toBe("call_1");
    expect(result[0].content).toBe("Sunny, 25C");
  });

  it("converts structured tool result parts via value field", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            { value: { filePath: "/tmp/a.txt", content: "hello" } },
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].tool_call_id).toBe("call_1");
    expect(result[0].content).toContain("filePath");
    expect(result[0].content).toContain("/tmp/a.txt");
    expect(result[0].content).toContain("hello");
  });

  it("drops cache-control metadata from tool result parts", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            { mimeType: "cache_control", data: "ZXBoZW1lcmFs" },
            new vscode.LanguageModelTextPart("real result"),
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].content).toBe("real result");
  });

  it("decodes base64 json data parts in tool results", () => {
    const jsonBytes = Buffer.from(
      JSON.stringify({ filePath: "/tmp/a.txt", content: "hello" }),
      "utf8",
    );
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            { $mid: 24, mimeType: "application/json", data: jsonBytes.toString("base64") },
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].content).toContain("filePath");
    expect(result[0].content).toContain("/tmp/a.txt");
    expect(result[0].content).toContain("hello");
  });

  it("keeps plain text data strings unchanged even if they look like base64", () => {
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            { $mid: 24, mimeType: "text/plain", data: "eyJ9" },
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].content).toBe("eyJ9");
  });

  it("truncates tool result content when maxToolResultChars is set", () => {
    const longContent = "a".repeat(100);
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            new vscode.LanguageModelTextPart(longContent),
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any, { maxToolResultChars: 50 });
    expect(result[0].content).toBe("a".repeat(50) + "…");
  });

  it("does not truncate when content is within limit", () => {
    const shortContent = "short content";
    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelToolResultPart("call_1", [
            new vscode.LanguageModelTextPart(shortContent),
          ]),
        ],
      },
    ];
    const result = convertMessages(messages as any, { maxToolResultChars: 100 });
    expect(result[0].content).toBe(shortContent);
  });
});

describe("stripThinkTags", () => {
  it("removes think tags", () => {
    expect(stripThinkTags("<think>reasoning</think>answer")).toBe("answer");
  });

  it("handles nested multiline think tags", () => {
    expect(stripThinkTags("<think>\nstep1\nstep2\n</think>\nresult")).toBe("\nresult");
  });

  it("is case-insensitive", () => {
    expect(stripThinkTags("<THINK>hidden</THINK>visible")).toBe("visible");
  });

  it("returns plain text unchanged", () => {
    expect(stripThinkTags("plain text")).toBe("plain text");
  });

  it("handles incomplete open tag", () => {
    expect(stripThinkTags("<think>no close")).toBe("<think>no close");
  });
});

describe("filterThinkTagsFromChunk cross-chunk handling", () => {
  it("buffers partial open tag and resolves in next chunk", () => {
    const state = { insideThinkBlock: false, pendingText: "" };
    const result1 = filterThinkTagsFromChunk("hello <thin", state);
    expect(result1).toBe("hello ");

    const result2 = filterThinkTagsFromChunk("k>hidden</think> world", state);
    expect(result2).toBe(" world");
    expect(state.insideThinkBlock).toBe(false);
  });

  it("buffers partial close tag inside think block across chunks", () => {
    const state = { insideThinkBlock: true, pendingText: "" };
    const result1 = filterThinkTagsFromChunk("text </thin", state);
    expect(result1).toBe("");

    const result2 = filterThinkTagsFromChunk("k> visible", state);
    expect(result2).toBe(" visible");
    expect(state.insideThinkBlock).toBe(false);
  });

  it("buffers partial close tag starting with </ across chunks", () => {
    const state = { insideThinkBlock: true, pendingText: "" };
    const result1 = filterThinkTagsFromChunk("text </", state);
    expect(result1).toBe("");

    const result2 = filterThinkTagsFromChunk("think> visible", state);
    expect(result2).toBe(" visible");
    expect(state.insideThinkBlock).toBe(false);
  });
});

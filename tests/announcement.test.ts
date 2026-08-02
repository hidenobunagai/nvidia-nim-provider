import { buildMissingToolCallNudge, looksLikeActionAnnouncement } from "../src/announcement";

describe("looksLikeActionAnnouncement", () => {
  describe("matches action announcements", () => {
    it.each([
      // Japanese announcements (the originally reported failure mode)
      "テストを実行します。",
      "これでプロンプトの強化が完了しました。テストを実行します。",
      "テストを実行します",
      "変更をコミットします。",
      "次にビルドを実行して確認します。",
      "確認してみます",
      "ファイルを修正します。",
      "パッケージをインストールします!",
      // English announcements
      "I will run the tests.",
      "Let me check the file.",
      "Now I'll fix the bug.",
      "Next, I will update the config",
      "I'm going to run the build.",
      "The changes are in place. I will now run the test suite.",
      // Chinese announcements
      "我现在运行测试。",
      "我将执行测试",
      "我来检查一下代码。",
    ])("matches: %s", (text) => {
      expect(looksLikeActionAnnouncement(text)).toBe(true);
    });
  });

  describe("does not match final answers or plain text", () => {
    it.each([
      // Japanese completion reports — 完了/終了 are not action announcements
      "修正が完了しました。",
      "以上が変更内容の説明です。",
      "テストはすべて成功しました。",
      "問題ありません。",
      // Japanese statements that merely end with ます without a tool-requiring verb
      "この場合はエラーになります。",
      "そうするとします。",
      // English final answers
      "The fix is complete.",
      "Here is the summary of changes.",
      "All tests pass now.",
      // Code / structured endings
      "Use the following command:\n```sh\nnpm test\n```",
      "done",
    ])("does not match: %s", (text) => {
      expect(looksLikeActionAnnouncement(text)).toBe(false);
    });
  });

  it("returns false for empty and whitespace-only text", () => {
    expect(looksLikeActionAnnouncement("")).toBe(false);
    expect(looksLikeActionAnnouncement("   \n  ")).toBe(false);
  });

  it("only inspects the tail of long texts", () => {
    const longPrefix = `${"結果の説明。".repeat(200)}\n`;
    expect(looksLikeActionAnnouncement(`${longPrefix}テストを実行します。`)).toBe(true);
    expect(looksLikeActionAnnouncement(`テストを実行します。${longPrefix}`)).toBe(false);
  });
});

describe("buildMissingToolCallNudge", () => {
  it("mentions the missing tool call and offers an exit", () => {
    const nudge = buildMissingToolCallNudge();
    expect(nudge).toContain("no tool call was emitted");
    expect(nudge).toContain("emit the tool call NOW");
    expect(nudge).toContain("final answer");
  });
});

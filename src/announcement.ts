// announcement.ts — detect responses that end by announcing an action instead
// of performing it, and build the nudge used to continue the turn.
//
// Weaker models sometimes end their turn with text like "テストを実行します。"
// ("I will run the tests.") or "Let me run the tests." without emitting the
// corresponding tool call.  In an agentic loop this silently ends the turn
// before the announced action ever happens.  These helpers detect such
// "action announcements" so the streaming layer can nudge the model to
// actually emit the tool call.

/** Maximum number of trailing characters inspected for an announcement. */
const ANNOUNCEMENT_SCAN_CHARS = 240;

/**
 * Japanese action verbs that require a tool call when announced as the next
 * step.  Matches e.g. 「テストを実行します。」「変更をコミットします」
 * 「確認してみます」.  Verbs that produce only prose (説明, 報告, ...) are
 * intentionally excluded: announcing them does not imply a missing tool call.
 */
const JAPANESE_ACTION_ANNOUNCEMENT_PATTERN =
  /(?:実行|確認|検証|テスト|診断|作成|修正|更新|編集|変更|適用|追加|削除|実装|調査|分析|インストール|ビルド|コンパイル|コミット|プッシュ|デプロイ|起動|再実行|読み込み|読み取り|書き込み|書き換え|置換|チェック|レビュー)(?:を|し|して|してみ|み)?ます(?:ね)?[。！!]?$/u;

/**
 * English first-person announcements of an imminent action.
 * Matches e.g. "I will run the tests.", "Let me check the file.",
 * "Now I'll fix it."
 */
const ENGLISH_ACTION_ANNOUNCEMENT_PATTERN =
  /(?:^|[\s.!?])(?:I(?:'ll| will| shall|'m going to| am going to)|Let me|Now,? I(?:'ll| will)|Next,? I(?:'ll| will))(?:\s+[\w`'"()-]+){0,12}[.!?]?$/i;

/**
 * Chinese announcements of an imminent action.  The action verb may be
 * followed by a short object (verb-object order), e.g. 「我现在运行测试。」
 * 「我来检查一下代码。」.  Clause separators are excluded from the object
 * part so statements like 「我们测试了代码，结果如下」 do not match.
 */
const CHINESE_ACTION_ANNOUNCEMENT_PATTERN =
  /我(?:们)?(?:现在)?(?:将|要|会|来)?(?:开始)?(?:执行|运行|检查|测试|验证|创建|修改|更新|编辑|构建|编译|部署|提交|安装|查看|读取|写入|分析)(?:一下)?[^。！!，、；：]{0,20}[。！!]?$/u;

/**
 * Returns true when the given response text ends with an announcement of an
 * action the model is about to take (Japanese, English, or Chinese), which in
 * an agentic context almost always means a tool call should have followed.
 * Conservative on purpose: false negatives keep the status quo, while false
 * positives cost at most one extra continuation request.
 */
export function looksLikeActionAnnouncement(text: string): boolean {
  const tail = text.trimEnd().slice(-ANNOUNCEMENT_SCAN_CHARS);
  if (!tail) return false;
  return (
    JAPANESE_ACTION_ANNOUNCEMENT_PATTERN.test(tail) ||
    ENGLISH_ACTION_ANNOUNCEMENT_PATTERN.test(tail) ||
    CHINESE_ACTION_ANNOUNCEMENT_PATTERN.test(tail)
  );
}

/**
 * Build the transient user message appended after an action announcement that
 * arrived without a tool call.  Gives the model an explicit choice: emit the
 * announced tool call now, or provide the final answer if the work is done.
 */
export function buildMissingToolCallNudge(): string {
  return [
    "You ended your last response by announcing an action, but no tool call was emitted.",
    "If you intended to perform that action, emit the tool call NOW (without repeating the announcement).",
    "If the task is already complete, provide the final answer instead.",
  ].join(" ");
}

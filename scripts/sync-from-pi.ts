#!/usr/bin/env bun
/**
 * Sync from Pi's nvidia.json to nvidia-nim-provider.
 * - Compares Pi's provider data (contextWindow/maxTokens/vision) with the
 *   KNOWN_MODEL_OVERRIDES table in src/model-catalog.ts.
 * - Default: --check (report diff, exit 1 on drift). With --write, updates
 *   src/model-catalog.ts.
 *
 * Pi source resolution:
 *  1) Local pi-ai install (global bun)
 *  2) `find` over ~/.bun caches (bun-only, guarded)
 *  3) Fallback fetch from jsdelivr/unpkg
 *
 * Usage:
 *   bun scripts/sync-from-pi.ts            # check
 *   bun scripts/sync-from-pi.ts --write    # update files
 *   bun run sync:pi                        # alias for --check
 *   bun run sync:pi:write                  # alias for --write
 *
 * Note: module scope has no side effects and no import.meta/Bun usage so the
 * pure functions can be unit-tested via ts-jest (see tests/sync-from-pi.test.ts).
 */
import fs from "fs";
import path from "path";
import os from "os";

export type PiModel = {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
};

export type PiData = Record<string, Record<string, PiModel>>;

const DEFAULT_CONTEXT_WINDOW = 131072;
const DEFAULT_MAX_OUTPUT_TOKENS = 65536;

// Fields we refuse to apply, keyed by model id. Seeded after reviewing the
// first sync (2026-08): each entry below was rejected because Pi's value is
// wrong or harmful — see the inline comment per model.
const IGNORED: Record<string, string[]> = {
  // Pi says 16K, but the Llama 3.1 family is 128K; the 16000 looks like a typo.
  "meta/llama-3.1-8b-instruct": ["contextWindow"],
  // Pi says 8192 output tokens, which would defeat the 16K reasoning floor in src/streaming/openai.ts.
  "openai/gpt-oss-120b": ["maxOutputTokens"],
  // Pi says 128K, but NVIDIA documents 256K for Cosmos Reason2 8B.
  "nvidia/cosmos-reason2-8b": ["contextWindow"],
};

function findPiJsonLocal(): string | null {
  const globalPath = path.join(
    os.homedir(),
    ".bun/install/global/node_modules/@earendil-works/pi-ai/dist/providers/data/nvidia.json",
  );
  if (fs.existsSync(globalPath) && fs.statSync(globalPath).isFile()) return globalPath;
  // Fallback: locate nvidia.json inside bun caches (bun-only API; never runs under jest)
  const bunGlobal = globalThis as {
    Bun?: { spawnSync: (cmd: string[], opts: { stdout: "pipe" }) => { stdout: Buffer } };
  };
  const bun = bunGlobal.Bun;
  if (bun) {
    try {
      const proc = bun.spawnSync(
        ["find", path.join(os.homedir(), ".bun"), "-name", "nvidia.json", "-path", "*pi-ai*dist/providers/data/nvidia.json"],
        { stdout: "pipe" },
      );
      const out = proc.stdout.toString().trim().split("\n").filter(Boolean);
      if (out.length > 0) return out.sort((a, b) => a.length - b.length)[0];
    } catch {}
  }
  return null;
}

async function loadPiData(): Promise<{ data: PiData; source: string }> {
  const local = findPiJsonLocal();
  if (local) {
    console.log(`Found Pi JSON locally: ${local}`);
    return { data: JSON.parse(fs.readFileSync(local, "utf8")) as PiData, source: local };
  }
  const urls = [
    "https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai/dist/providers/data/nvidia.json",
    "https://unpkg.com/@earendil-works/pi-ai/dist/providers/data/nvidia.json",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return { data: (await res.json()) as PiData, source: url };
    } catch {}
  }
  throw new Error("Could not locate Pi nvidia.json locally or via CDN");
}

function flattenPi(data: PiData): Map<string, PiModel> {
  const map = new Map<string, PiModel>();
  for (const models of Object.values(data)) {
    for (const [id, model] of Object.entries(models)) {
      map.set(id, model);
    }
  }
  return map;
}

/** Parse the Record-style override table: `"id": { ... },` blocks. */
function parseCatalogEntries(src: string): Map<string, { block: string; fields: Map<string, string> }> {
  const entries = new Map<string, { block: string; fields: Map<string, string> }>();
  const blockRegex = /("([^"]+)":\s*\{[\s\S]*?\n  \},?)/g;
  const fieldRegex = /(\w+):\s*([^,\n]+),/g;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(src))) {
    const block = m[0];
    const fields = new Map<string, string>();
    let f: RegExpExecArray | null;
    while ((f = fieldRegex.exec(block))) {
      fields.set(f[1], f[2].trim());
    }
    entries.set(m[2], { block, fields });
  }
  return entries;
}

// Canonical field order inside a block; insertions keep this grouping.
const FIELD_ORDER = ["displayName", "contextWindow", "maxOutputTokens", "supportsVision", "supportsTools"];

/** Replace `field: x,` if present, else insert after the previous canonical field's line. */
function ensureField(block: string, field: string, value: string): string {
  const re = new RegExp(`${field}:\\s*[^,\\n]+,`);
  if (re.test(block)) {
    return block.replace(re, `${field}: ${value},`);
  }
  const prev = FIELD_ORDER[FIELD_ORDER.indexOf(field) - 1];
  const anchor = new RegExp(`(    ${prev}: [^,\\n]+,\\n)`);
  return block.replace(anchor, `$1    ${field}: ${value},\n`);
}

export type SyncOptions = { ignored?: Record<string, string[]> };

export function syncCatalog(
  src: string,
  piMap: Map<string, PiModel>,
  options: SyncOptions = {},
): { out: string; diffs: string[]; changed: number; piOnly: string[]; overrideOnly: number } {
  const ignored = options.ignored ?? {};
  const entries = parseCatalogEntries(src);
  let out = src;
  const diffs: string[] = [];
  const piOnly: string[] = [];
  let changed = 0;

  for (const [piId, piModel] of piMap.entries()) {
    const entry = entries.get(piId);
    if (!entry) {
      piOnly.push(piId);
      continue;
    }
    let block = entry.block;
    const expected: Record<"contextWindow" | "maxOutputTokens" | "supportsVision", number | boolean> = {
      contextWindow: piModel.contextWindow,
      maxOutputTokens: piModel.maxTokens,
      supportsVision: piModel.input.includes("image"),
    };
    for (const [field, expValue] of Object.entries(expected)) {
      if (ignored[piId]?.includes(field)) continue;
      const curRaw = entry.fields.get(field);
      let curValue: number | boolean;
      if (field === "supportsVision") {
        curValue = curRaw ? curRaw === "true" : false;
      } else {
        curValue = curRaw
          ? Number(curRaw)
          : field === "contextWindow"
            ? DEFAULT_CONTEXT_WINDOW
            : DEFAULT_MAX_OUTPUT_TOKENS;
      }
      if (curValue === expValue) continue;
      const next = ensureField(block, field, String(expValue));
      if (next === block) continue; // displayName anchor missing — leave untouched
      diffs.push(`${piId}: ${field} ${curValue} -> ${expValue}`);
      block = next;
      changed++;
    }
    if (block !== entry.block) {
      out = out.replace(entry.block, block);
    }
  }

  let piHit = 0;
  for (const id of entries.keys()) {
    if (piMap.has(id)) piHit++;
  }
  return { out, diffs, changed, piOnly, overrideOnly: entries.size - piHit };
}

async function main() {
  const write = process.argv.includes("--write");
  const verbose = process.argv.includes("--verbose");
  const catalogPath = path.resolve(path.dirname(process.argv[1]), "../src/model-catalog.ts");

  console.log(`🔍 Sync from Pi — ${write ? "WRITE" : "CHECK"} mode`);
  const { data, source } = await loadPiData();
  console.log(`Source: ${source}`);
  const piMap = flattenPi(data);
  console.log(`Pi models: ${piMap.size}`);

  const { out, diffs, changed, piOnly, overrideOnly } = syncCatalog(
    fs.readFileSync(catalogPath, "utf8"),
    piMap,
    { ignored: IGNORED },
  );

  if (diffs.length === 0) {
    console.log("✅ No differences — already in sync with Pi");
  } else {
    console.log(`\nDifferences (${diffs.length}):`);
    for (const d of diffs.slice(0, 50)) console.log(`  - ${d}`);
    if (diffs.length > 50) console.log(`  ... and ${diffs.length - 50} more`);
    if (write) {
      fs.writeFileSync(catalogPath, out, "utf8");
      console.log(`\n✅ Applied ${changed} field updates to ${catalogPath}`);
      console.log("Next: bun run test && bun run lint && bun run compile");
      console.log("Then: fix stale Notes in docs/models.md (deepseek 128K->1M, cosmos-reason2-8b, minimax-m3)");
    } else {
      console.log("\nRun with --write to apply: bun run sync:pi:write");
    }
  }
  if (piOnly.length > 0) {
    console.log(`\nℹ️  In Pi but not in override (${piOnly.length}): ${verbose ? piOnly.join(", ") : "use --verbose to list"}`);
  }
  if (overrideOnly > 0) {
    console.log(`ℹ️  Override entries not in Pi (${overrideOnly}): left untouched`);
  }

  if (!write && diffs.length > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("scripts/sync-from-pi.ts")) {
  main();
}

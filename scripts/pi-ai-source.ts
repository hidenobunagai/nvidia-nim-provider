/**
 * Loads pi-ai's provider data for the catalog gate (scripts/sync-from-pi.ts).
 *
 * Kept byte-identical in opencode-go-provider, opencode-zen-provider and
 * nvidia-nim-provider — change all three together.
 *
 * Resolution:
 *  1) The npm registry's `latest` pi-ai version, fetched pinned to that version from
 *     jsdelivr, then unpkg. Pinning matters: the CDNs cache unversioned URLs for days.
 *  2) Offline: the newest local copy (global bun install or bun cache) by package.json
 *     version, with a warning, since a local copy can lag the published one.
 *
 * No module-scope side effects and no Bun / import.meta, so jest can import it.
 */
import fs from "fs";
import os from "os";
import path from "path";

const PKG = "@earendil-works/pi-ai";
const REGISTRY_URL = `https://registry.npmjs.org/${PKG}/latest`;
const CDNS = ["https://cdn.jsdelivr.net/npm", "https://unpkg.com"];
const TIMEOUT_MS = 10_000;

export type PiAiSource<T> = {
  data: T;
  /** Where the data came from, with the pi-ai version and whether it is the latest. */
  source: string;
  version: string;
};

export type LoadOptions = {
  fetch?: typeof fetch;
  /** pi-ai package directories to consider when offline. */
  dirs?: string[];
  warn?: (msg: string) => void;
};

/** Compares dotted versions numerically; a prerelease sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const dash = v.indexOf("-");
    const core = dash < 0 ? v : v.slice(0, dash);
    return { nums: core.split(".").map(Number), pre: dash < 0 ? "" : v.slice(dash + 1) };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The global bun install plus every pi-ai copy in the bun cache. */
export function defaultPiAiDirs(home = os.homedir()): string[] {
  const dirs = [path.join(home, ".bun/install/global/node_modules", PKG)];
  const cache = path.join(home, ".bun/install/cache/@earendil-works");
  try {
    for (const e of fs.readdirSync(cache)) {
      if (e.startsWith("pi-ai@")) dirs.push(path.join(cache, e));
    }
  } catch {}
  return dirs;
}

/** The highest-versioned dir that has `dist/providers/data/<file>`. */
export function newestLocal(
  file: string,
  dirs: string[],
): { path: string; version: string } | null {
  let best: { path: string; version: string } | null = null;
  for (const dir of dirs) {
    const p = path.join(dir, "dist/providers/data", file);
    try {
      const { version } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        version?: unknown;
      };
      if (typeof version !== "string" || !fs.existsSync(p)) continue;
      if (!best || compareVersions(version, best.version) > 0) best = { path: p, version };
    } catch {}
  }
  return best;
}

/** Loads `dist/providers/data/<file>` from the latest published pi-ai (see file header). */
export async function loadPiAiData<T>(
  file: string,
  opts: LoadOptions = {},
): Promise<PiAiSource<T>> {
  const doFetch = opts.fetch ?? fetch;
  const warn = opts.warn ?? ((msg: string) => console.warn(`⚠️  ${msg}`));
  const get = (url: string) => doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

  let latest: string | null = null;
  try {
    const res = await get(REGISTRY_URL);
    const version = res.ok ? ((await res.json()) as { version?: unknown }).version : undefined;
    if (typeof version === "string") latest = version;
    else warn(`npm registry gave no pi-ai version (HTTP ${res.status})`);
  } catch (e) {
    warn(`npm registry unreachable: ${e}`);
  }

  if (latest) {
    for (const cdn of CDNS) {
      const url = `${cdn}/${PKG}@${latest}/dist/providers/data/${file}`;
      try {
        const res = await get(url);
        if (res.ok) {
          return {
            data: (await res.json()) as T,
            source: `${url} (pi-ai ${latest}, latest)`,
            version: latest,
          };
        }
        warn(`${url} returned HTTP ${res.status}`);
      } catch (e) {
        warn(`${url} failed: ${e}`);
      }
    }
  }

  const local = newestLocal(file, opts.dirs ?? defaultPiAiDirs());
  if (!local) throw new Error(`Could not load pi-ai ${file} from npm/CDN or a local install`);
  const note =
    latest === null
      ? "latest unknown"
      : local.version === latest
        ? "latest"
        : `latest is ${latest} — comparing against stale data`;
  warn(`using local pi-ai ${local.version} (${note})`);
  return {
    data: JSON.parse(fs.readFileSync(local.path, "utf8")) as T,
    source: `${local.path} (pi-ai ${local.version}, local fallback, ${note})`,
    version: local.version,
  };
}

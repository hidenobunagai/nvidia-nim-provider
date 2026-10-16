// Kept byte-identical across the three provider repos, like scripts/pi-ai-source.ts.
import fs from "fs";
import os from "os";
import path from "path";
import { compareVersions, loadPiAiData, newestLocal } from "../scripts/pi-ai-source";

function piAiDir(root: string, version: string, data?: object): string {
  const dir = path.join(root, `pi-ai@${version}`);
  fs.mkdirSync(path.join(dir, "dist/providers/data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
  if (data) fs.writeFileSync(path.join(dir, "dist/providers/data/x.json"), JSON.stringify(data));
  return dir;
}

function fakeFetch(routes: Record<string, unknown>): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (!(url in routes)) throw new Error("offline");
    return { ok: true, status: 200, json: async () => routes[url] } as Response;
  };
  return { fetch: impl as typeof fetch, urls };
}

describe("compareVersions", () => {
  it("orders numerically, with prereleases before their release", () => {
    const sorted = ["1.10.0", "1.3.0", "1.3.0-beta.10", "0.99.2", "1.3.0-beta.9", "1.2.0"].sort(
      compareVersions,
    );
    expect(sorted).toEqual(["0.99.2", "1.2.0", "1.3.0-beta.9", "1.3.0-beta.10", "1.3.0", "1.10.0"]);
  });
});

describe("newestLocal / loadPiAiData", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ai-source-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("picks the highest version that has the data file, not the first found", () => {
    const dirs = [
      piAiDir(root, "1.2.0", { v: "1.2.0" }),
      piAiDir(root, "1.10.0", { v: "1.10.0" }),
      piAiDir(root, "2.0.0"), // no data file
      path.join(root, "missing"),
    ];
    expect(newestLocal("x.json", dirs)?.version).toBe("1.10.0");
  });

  it("fetches the registry's latest version pinned on the CDN", async () => {
    const local = [piAiDir(root, "1.2.0", { v: "local" })];
    const pinned =
      "https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@1.3.0/dist/providers/data/x.json";
    const { fetch, urls } = fakeFetch({
      "https://registry.npmjs.org/@earendil-works/pi-ai/latest": { version: "1.3.0" },
      [pinned]: { v: "cdn" },
    });
    const res = await loadPiAiData("x.json", { fetch, dirs: local, warn: () => {} });
    expect(res.data).toEqual({ v: "cdn" });
    expect(res.version).toBe("1.3.0");
    expect(res.source).toBe(`${pinned} (pi-ai 1.3.0, latest)`);
    expect(urls).toHaveLength(2);
  });

  it("falls back to unpkg, then to a local copy only if it is the latest version", async () => {
    const registry = {
      "https://registry.npmjs.org/@earendil-works/pi-ai/latest": { version: "1.3.0" },
    };
    const { fetch, urls } = fakeFetch(registry);
    const stale = [piAiDir(root, "1.2.0", { v: "stale" })];
    await expect(loadPiAiData("x.json", { fetch, dirs: stale, warn: () => {} })).rejects.toThrow(
      "refusing to compare against local 1.2.0",
    );
    expect(urls[2]).toBe(
      "https://unpkg.com/@earendil-works/pi-ai@1.3.0/dist/providers/data/x.json",
    );
    const current = [...stale, piAiDir(root, "1.3.0", { v: "current" })];
    const res = await loadPiAiData("x.json", { fetch, dirs: current, warn: () => {} });
    expect(res.data).toEqual({ v: "current" });
    expect(res.source).toContain("pi-ai 1.3.0, local fallback, latest");
  });

  it("uses the newest local copy when the registry is unreachable, and throws with none", async () => {
    const { fetch } = fakeFetch({});
    const dirs = [piAiDir(root, "1.2.0", { v: "local" })];
    const res = await loadPiAiData("x.json", { fetch, dirs, warn: () => {} });
    expect(res.source).toContain("latest unknown");
    await expect(loadPiAiData("x.json", { fetch, dirs: [], warn: () => {} })).rejects.toThrow(
      "Could not load pi-ai x.json",
    );
  });
});

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { refFromPath } from "./sources/index.js";
import type { DiscoverOptions, HarnessName, SessionRef } from "./types.js";

export interface SourceRoot {
  harness: HarnessName;
  root: string;
  exists: boolean;
}

// Default transcript roots. Only claude-code is parseable in v0.1, but we
// report the others so `iso-trace sources` is honest about what's detected
// on disk and what will land in future versions.
export function defaultRoots(): SourceRoot[] {
  const home = homedir();
  const roots: SourceRoot[] = [
    { harness: "claude-code", root: join(home, ".claude", "projects"), exists: false },
    { harness: "codex", root: join(home, ".codex", "sessions"), exists: false },
    { harness: "opencode", root: join(home, ".opencode", "sessions"), exists: false },
  ];
  for (const r of roots) {
    r.exists = safeIsDir(r.root);
  }
  return roots;
}

export async function discoverSessions(opts: DiscoverOptions = {}): Promise<SessionRef[]> {
  const harnessFilter = opts.harness;
  const sinceMs = parseSinceCutoff(opts.since);
  const cwdFilter = opts.cwd ? resolve(opts.cwd) : undefined;
  const roots = (opts.roots ?? defaultRoots().map((r) => r.root))
    .map((r) => ({ path: r, harness: inferHarnessFromRoot(r) }))
    .filter((r): r is { path: string; harness: HarnessName } => r.harness !== undefined)
    .filter((r) => !harnessFilter || r.harness === harnessFilter);

  const refs: SessionRef[] = [];
  for (const { path, harness } of roots) {
    if (harness !== "claude-code") continue;
    if (!safeIsDir(path)) continue;
    for (const file of enumerateJsonl(path)) {
      try {
        const ref = refFromPath(file, harness);
        if (cwdFilter && ref.cwd !== cwdFilter) continue;
        if (sinceMs !== undefined && Date.parse(ref.startedAt) < sinceMs) continue;
        refs.push(ref);
      } catch {
        // skip unreadable / malformed files silently — `show` surfaces the real error
      }
    }
  }
  refs.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  return refs;
}

function inferHarnessFromRoot(root: string): HarnessName | undefined {
  const norm = root.replace(/\\/g, "/");
  if (norm.includes("/.claude/")) return "claude-code";
  if (norm.includes("/.codex/")) return "codex";
  if (norm.includes("/.opencode/")) return "opencode";
  return undefined;
}

function safeIsDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function enumerateJsonl(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const child of enumerateJsonl(full)) out.push(child);
    } else if (st.isFile() && name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

export function parseSinceCutoff(since: string | undefined): number | undefined {
  if (!since) return undefined;
  const rel = since.match(/^(\d+)([smhdw])$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return Date.now() - n * ms[unit];
  }
  const abs = Date.parse(since);
  if (!Number.isNaN(abs)) return abs;
  throw new Error(`iso-trace: unrecognised --since value "${since}" (use e.g. "7d", "6h", or an ISO timestamp)`);
}

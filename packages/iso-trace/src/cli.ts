#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoots, discoverSessions } from "./discover.js";
import { exportSession, type ExportFormat } from "./export.js";
import { findSessionById, iterateEvents, stats } from "./query.js";
import { loadSessionFromPath } from "./sources/index.js";
import type { Event, Session, SessionRef } from "./types.js";

const USAGE = `iso-trace — local observability for AI coding agent transcripts

usage:
  iso-trace --version | -v
  iso-trace --help | -h
  iso-trace list    [--since <7d|ISO>] [--cwd <dir>] [--json]
  iso-trace show    <id-or-prefix>  [--events <kinds>] [--grep <regex>]
  iso-trace stats   [<id-or-prefix>...]  [--since <7d|ISO>] [--cwd <dir>]
  iso-trace stats   --source <path>   (stats on a single transcript file, for smoke/tests)
  iso-trace export  <id-or-prefix>  [--format json|jsonl]
  iso-trace sources
  iso-trace where
`;

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

async function cmdList(args: string[]): Promise<number> {
  const opts = parseCommonFilters(args);
  if (opts.error) {
    console.error(opts.error);
    return 2;
  }
  const refs = await discoverSessions({ since: opts.since, cwd: opts.cwd });
  if (opts.json) {
    console.log(JSON.stringify(refs, null, 2));
    return 0;
  }
  if (refs.length === 0) {
    console.error("iso-trace: no sessions found");
    console.error("  run `iso-trace sources` to see where iso-trace looks.");
    return 2;
  }
  console.log(formatSessionTable(refs));
  return 0;
}

async function cmdShow(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("iso-trace show: missing <id-or-prefix>");
    return 2;
  }
  const idOrPrefix = args[0];
  const rest = args.slice(1);
  let kindFilter: Set<Event["kind"]> | undefined;
  let grep: RegExp | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--events") {
      const raw = (rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      kindFilter = new Set(raw as Event["kind"][]);
    } else if (a === "--grep") {
      const pat = rest[++i];
      if (!pat) {
        console.error("iso-trace show: --grep requires a pattern");
        return 2;
      }
      try {
        grep = new RegExp(pat, "i");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`iso-trace show: invalid --grep regex: ${msg}`);
        return 2;
      }
    } else {
      console.error(`iso-trace show: unknown flag "${a}"`);
      return 2;
    }
  }
  const refs = await discoverSessions();
  const ref = findSessionById(refs, idOrPrefix);
  if (!ref) {
    console.error(`iso-trace show: no session matches "${idOrPrefix}"`);
    return 2;
  }
  const session = loadSessionFromPath((ref as SessionRef).source.path, (ref as SessionRef).source.harness);
  console.log(formatSessionHeader(session));
  for (const { event, turnIndex, role, at } of iterateEvents(session)) {
    if (kindFilter && !kindFilter.has(event.kind)) continue;
    const line = formatEventLine(event, turnIndex, role, at);
    if (grep && !grep.test(line)) continue;
    console.log(line);
  }
  return 0;
}

async function cmdStats(args: string[]): Promise<number> {
  let source: string | undefined;
  const positional: string[] = [];
  const filterArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source") {
      source = args[++i];
    } else if (a === "--since" || a === "--cwd" || a === "--json") {
      filterArgs.push(a);
      if (a !== "--json") filterArgs.push(args[++i] ?? "");
    } else if (a.startsWith("--")) {
      console.error(`iso-trace stats: unknown flag "${a}"`);
      return 2;
    } else {
      positional.push(a);
    }
  }

  let sessions: Session[];
  if (source) {
    if (!existsSync(source)) {
      console.error(`iso-trace stats: --source file not found: ${source}`);
      return 2;
    }
    sessions = [loadSessionFromPath(resolve(source))];
  } else if (positional.length > 0) {
    const refs = await discoverSessions();
    sessions = [];
    for (const idOrPrefix of positional) {
      const ref = findSessionById(refs, idOrPrefix);
      if (!ref) {
        console.error(`iso-trace stats: no session matches "${idOrPrefix}"`);
        return 2;
      }
      sessions.push(loadSessionFromPath((ref as SessionRef).source.path, (ref as SessionRef).source.harness));
    }
  } else {
    const opts = parseCommonFilters(filterArgs);
    if (opts.error) {
      console.error(opts.error);
      return 2;
    }
    const refs = await discoverSessions({ since: opts.since, cwd: opts.cwd });
    sessions = refs.map((r) => loadSessionFromPath(r.source.path, r.source.harness));
  }

  const result = stats(sessions);
  console.log(formatStats(result));
  return 0;
}

async function cmdExport(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("iso-trace export: missing <id-or-prefix>");
    return 2;
  }
  const idOrPrefix = args[0];
  let format: ExportFormat = "json";
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--format") {
      const raw = args[++i];
      if (raw !== "json" && raw !== "jsonl") {
        console.error(`iso-trace export: --format must be json or jsonl`);
        return 2;
      }
      format = raw;
    } else {
      console.error(`iso-trace export: unknown flag "${a}"`);
      return 2;
    }
  }
  const refs = await discoverSessions();
  const ref = findSessionById(refs, idOrPrefix);
  if (!ref) {
    console.error(`iso-trace export: no session matches "${idOrPrefix}"`);
    return 2;
  }
  const session = loadSessionFromPath((ref as SessionRef).source.path, (ref as SessionRef).source.harness);
  process.stdout.write(exportSession(session, format));
  return 0;
}

function cmdSources(): number {
  for (const r of defaultRoots()) {
    const marker = r.exists ? "✓" : "·";
    const note =
      r.harness === "claude-code" ? "parser ready" : "parser lands in v0.2";
    console.log(`${marker} ${r.harness.padEnd(12)} ${r.root}  (${note})`);
  }
  return 0;
}

function cmdWhere(): number {
  for (const r of defaultRoots()) console.log(r.root);
  return 0;
}

interface CommonFilters {
  since?: string;
  cwd?: string;
  json: boolean;
  error?: string;
}

function parseCommonFilters(args: string[]): CommonFilters {
  const out: CommonFilters = { json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--since") out.since = args[++i];
    else if (a === "--cwd") out.cwd = args[++i];
    else if (a === "--json") out.json = true;
    else {
      out.error = `iso-trace: unknown flag "${a}"`;
      return out;
    }
  }
  return out;
}

function formatSessionTable(refs: SessionRef[]): string {
  const header = ["id", "started", "cwd", "turns", "size"];
  const rows = refs.map((r) => [
    r.id,
    r.startedAt,
    shorten(r.cwd, 40),
    String(r.turnCount),
    prettyBytes(r.sizeBytes),
  ]);
  return formatTable([header, ...rows]);
}

function formatSessionHeader(s: Session): string {
  const lines: string[] = [];
  lines.push(`session:   ${s.id}`);
  lines.push(`source:    ${s.source.harness} (${s.source.format})`);
  lines.push(`path:      ${s.source.path}`);
  lines.push(`cwd:       ${s.cwd}`);
  if (s.model) lines.push(`model:     ${s.model}`);
  lines.push(`started:   ${s.startedAt}`);
  if (s.endedAt) lines.push(`ended:     ${s.endedAt}`);
  lines.push(`duration:  ${formatDuration(s.durationMs)}`);
  lines.push(`turns:     ${s.turns.length}`);
  lines.push(
    `tokens:    input=${s.tokenUsage.input} output=${s.tokenUsage.output} cacheRead=${s.tokenUsage.cacheRead} cacheCreated=${s.tokenUsage.cacheCreated}`,
  );
  lines.push("");
  return lines.join("\n");
}

function formatEventLine(e: Event, turnIndex: number, role: string, at: string): string {
  const head = `t${String(turnIndex).padStart(3, "0")} ${role.padEnd(9)} ${at}`;
  switch (e.kind) {
    case "message":
      return `${head}  message(${e.role}) ${shorten(e.text.replace(/\s+/g, " "), 120)}`;
    case "tool_call":
      return `${head}  tool_call ${e.name}(${shorten(JSON.stringify(e.input ?? {}), 120)})`;
    case "tool_result":
      return `${head}  tool_result(${e.toolUseId}) ${shorten(e.output.replace(/\s+/g, " "), 120)}${e.error ? `  [error]` : ""}`;
    case "file_op":
      return `${head}  file_op ${e.op} ${e.path}${e.bytesChanged ? `  ${e.bytesChanged}B` : ""}`;
    case "token_usage":
      return `${head}  tokens in=${e.input} out=${e.output} cacheRead=${e.cacheRead} cacheCreated=${e.cacheCreated}${e.model ? `  (${e.model})` : ""}`;
    default: {
      const exhaustive: never = e;
      return `${head}  ${String(exhaustive)}`;
    }
  }
}

function formatStats(s: ReturnType<typeof stats>): string {
  const lines: string[] = [];
  lines.push(`sessions:  ${s.sessions}`);
  lines.push(`turns:     ${s.turns}`);
  lines.push(`duration:  ${formatDuration(s.durationMs)}`);
  lines.push(
    `tokens:    input=${s.tokens.input} output=${s.tokens.output} cacheRead=${s.tokens.cacheRead} cacheCreated=${s.tokens.cacheCreated}`,
  );
  const toolEntries = Object.entries(s.toolCalls).sort((a, b) => b[1] - a[1]);
  lines.push("");
  lines.push("tool calls:");
  if (toolEntries.length === 0) lines.push("  (none)");
  for (const [name, n] of toolEntries) lines.push(`  ${n.toString().padStart(5)} ${name}`);
  lines.push("");
  lines.push("file ops:");
  const fileOpEntries = Object.entries(s.fileOps).sort((a, b) => b[1] - a[1]);
  if (fileOpEntries.length === 0) lines.push("  (none)");
  for (const [op, n] of fileOpEntries) lines.push(`  ${n.toString().padStart(5)} ${op}`);
  lines.push("");
  lines.push(
    `files touched: ${s.filesTouched.read.length} read, ${s.filesTouched.written.length} written, ${s.filesTouched.edited.length} edited`,
  );
  return lines.join("\n");
}

function formatTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths = rows[0].map((_, colIdx) => Math.max(...rows.map((r) => (r[colIdx] ?? "").length)));
  return rows
    .map((r) => r.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  ").trimEnd())
    .join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m`;
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(readVersion());
    return 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);
  if (cmd === "list") return cmdList(rest);
  if (cmd === "show") return cmdShow(rest);
  if (cmd === "stats") return cmdStats(rest);
  if (cmd === "export") return cmdExport(rest);
  if (cmd === "sources") return cmdSources();
  if (cmd === "where") return cmdWhere();
  console.error(`iso-trace: unknown command "${cmd}"\n`);
  console.error(USAGE);
  return 2;
}

main(process.argv).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`iso-trace: ${msg}`);
    process.exit(1);
  },
);

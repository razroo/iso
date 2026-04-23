#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoots, discoverSessions, parseSinceCutoff } from "./discover.js";
import { exportSession, type ExportFormat } from "./export.js";
import { exportFixture } from "./fixture.js";
import { redactSession, type RedactionOptions } from "./redact.js";
import { findSessionById, iterateEvents, stats } from "./query.js";
import { modelScorecardFromRefs, type ModelScore } from "./scorecard.js";
import { loadSessionFromPath } from "./sources/index.js";
import type { Event, HarnessName, Session, SessionRef } from "./types.js";

const USAGE = `iso-trace — local observability for AI coding agent transcripts

usage:
  iso-trace --version | -v
  iso-trace --help | -h
  iso-trace list    [--since <7d|ISO>] [--cwd <dir>] [--json]
  iso-trace show    <id-or-prefix>  [--events <kinds>] [--grep <regex>]
  iso-trace stats   [<id-or-prefix>...]  [--since <7d|ISO>] [--cwd <dir>]
  iso-trace stats   --source <path>   (stats on a single transcript file, for smoke/tests)
  iso-trace model-score [--since <7d|ISO> | --since-hours <n>] [--cwd <dir>] [--harness <name>] [--tool <name>] [--fail-on-schema] [--fail-on-model <provider/model>] [--json]
  iso-trace export  <id-or-prefix>  [--format json|jsonl] [--redact] [--redact-regex <pattern>]
  iso-trace export-fixture  <id-or-prefix>  --out <dir> [--runner <name>] [--harness-source <path>] [--edit-checks placeholder|exists-only] [--redact] [--redact-regex <pattern>] [--run]
  iso-trace export-fixture  --source <path>  --out <dir> [--runner <name>] [--harness-source <path>] [--edit-checks placeholder|exists-only] [--redact] [--redact-regex <pattern>] [--run]
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
    if (!sourceExists(source)) {
      console.error(`iso-trace stats: --source file not found: ${source}`);
      return 2;
    }
    sessions = [loadSessionFromPath(resolveSourcePath(source))];
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
  let redact = false;
  const redactionPatterns: RegExp[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--format") {
      const raw = args[++i];
      if (raw !== "json" && raw !== "jsonl") {
        console.error(`iso-trace export: --format must be json or jsonl`);
        return 2;
      }
      format = raw;
    } else if (a === "--redact") {
      redact = true;
    } else if (a === "--redact-regex") {
      const compiled = compileRedactionPattern(args[++i], "iso-trace export");
      if (compiled instanceof Error) {
        console.error(compiled.message);
        return 2;
      }
      redact = true;
      redactionPatterns.push(compiled);
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
  let session = loadSessionFromPath((ref as SessionRef).source.path, (ref as SessionRef).source.harness);
  if (redact) {
    session = redactSession(session, { patterns: redactionPatterns });
  }
  process.stdout.write(exportSession(session, format));
  return 0;
}

async function cmdModelScore(args: string[]): Promise<number> {
  const opts = parseModelScoreArgs(args);
  if (opts.error) {
    console.error(opts.error);
    return 2;
  }

  const refs = await discoverModelScoreRefs(opts);
  if (refs.length === 0) {
    console.error("iso-trace model-score: no sessions found");
    return 2;
  }

  const scores = modelScorecardFromRefs(
    refs,
    (ref) => loadSessionFromPath(ref.source.path, ref.source.harness),
    { tool: opts.tool, sinceMs: opts.sinceMs },
  );
  if (scores.length === 0) {
    console.error(`iso-trace model-score: no matching tool calls found`);
    return 2;
  }

  if (opts.json) {
    console.log(JSON.stringify(scores, null, 2));
  } else {
    console.log(formatModelScoreTable(scores, opts.tool));
  }

  const failures = modelScoreFailureReasons(scores, opts);
  for (const failure of failures) {
    console.error(`iso-trace model-score: ${failure}`);
  }
  return failures.length > 0 ? 1 : 0;
}

async function cmdExportFixture(args: string[]): Promise<number> {
  let source: string | undefined;
  let out: string | undefined;
  let idOrPrefix: string | undefined;
  let runner: "fake" | "codex" | "claude-code" | "cursor" | "opencode" | undefined;
  let harnessSource: string | undefined;
  let editChecks: "placeholder" | "exists-only" = "placeholder";
  let redact = false;
  const redactionPatterns: RegExp[] = [];
  let run = false;
  let keepWorkspaces = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source") {
      source = args[++i];
    } else if (a === "--out") {
      out = args[++i];
    } else if (a === "--runner") {
      const raw = args[++i];
      if (raw !== "fake" && raw !== "codex" && raw !== "claude-code" && raw !== "cursor" && raw !== "opencode") {
        console.error(`iso-trace export-fixture: --runner must be fake, codex, claude-code, cursor, or opencode`);
        return 2;
      }
      runner = raw;
    } else if (a === "--harness-source") {
      harnessSource = args[++i];
      if (!harnessSource) {
        console.error(`iso-trace export-fixture: --harness-source requires a path`);
        return 2;
      }
    } else if (a === "--edit-checks") {
      const raw = args[++i];
      if (raw !== "placeholder" && raw !== "exists-only") {
        console.error(`iso-trace export-fixture: --edit-checks must be placeholder or exists-only`);
        return 2;
      }
      editChecks = raw;
    } else if (a === "--redact") {
      redact = true;
    } else if (a === "--redact-regex") {
      const compiled = compileRedactionPattern(args[++i], "iso-trace export-fixture");
      if (compiled instanceof Error) {
        console.error(compiled.message);
        return 2;
      }
      redact = true;
      redactionPatterns.push(compiled);
    } else if (a === "--run") {
      run = true;
    } else if (a === "--keep-workspaces") {
      keepWorkspaces = true;
    } else if (a.startsWith("--")) {
      console.error(`iso-trace export-fixture: unknown flag "${a}"`);
      return 2;
    } else if (!idOrPrefix) {
      idOrPrefix = a;
    } else {
      console.error(`iso-trace export-fixture: unexpected argument "${a}"`);
      return 2;
    }
  }
  if (!out) {
    console.error("iso-trace export-fixture: --out <dir> is required");
    return 2;
  }
  if (run && !runner) {
    console.error("iso-trace export-fixture: --run requires --runner <codex|claude-code|cursor|opencode>");
    return 2;
  }
  if (run && runner === "fake") {
    console.error("iso-trace export-fixture: --run is only useful with a real runner (codex, claude-code, cursor, or opencode)");
    return 2;
  }
  let session: Session;
  if (source) {
    if (!sourceExists(source)) {
      console.error(`iso-trace export-fixture: --source file not found: ${source}`);
      return 2;
    }
    session = loadSessionFromPath(resolveSourcePath(source));
  } else {
    if (!idOrPrefix) {
      console.error(
        "iso-trace export-fixture: pass <id-or-prefix> or --source <path>",
      );
      return 2;
    }
    const refs = await discoverSessions();
    const ref = findSessionById(refs, idOrPrefix);
    if (!ref) {
      console.error(`iso-trace export-fixture: no session matches "${idOrPrefix}"`);
      return 2;
    }
    session = loadSessionFromPath(
      (ref as SessionRef).source.path,
      (ref as SessionRef).source.harness,
    );
  }
  const redaction: RedactionOptions | undefined = redact ? { patterns: redactionPatterns } : undefined;
  const result = exportFixture(session, {
    out,
    runner,
    harnessSource,
    editChecks,
    redact: redaction,
  });
  console.log(`iso-trace: wrote fixture to ${result.outDir}`);
  console.log(`  task:      ${result.taskMdPath}`);
  console.log(`  workspace: ${result.workspaceDir} (${result.readFiles.length} baseline file(s) seeded)`);
  console.log(`  checks:    ${result.checksYmlPath} (${result.writtenFiles.length} write(s), ${result.editedFiles.length} edit(s))`);
  if (run) {
    if (editChecks === "placeholder" && result.editedFiles.length > 0) {
      console.error(
        `iso-trace export-fixture: --run with placeholder edit checks will fail until you replace REPLACE_ME values; use --edit-checks exists-only for an immediate smoke rerun`,
      );
      return 2;
    }
    if (!harnessSource) {
      console.error(`iso-trace export-fixture: warning: no --harness-source supplied; the rerun will not stage generated harness files`);
    }
    const evalArgs = ["run", result.checksYmlPath, "--runner", runner!];
    if (harnessSource) evalArgs.push("--harness-source", harnessSource);
    if (keepWorkspaces) evalArgs.push("--keep-workspaces");
    console.log(``);
    console.log(`running: iso-eval ${evalArgs.join(" ")}`);
    return runIsoEval(evalArgs);
  }
  console.log(``);
  console.log(`next:`);
  if (editChecks === "placeholder" && result.editedFiles.length > 0) {
    console.log(`  1. Edit ${result.checksYmlPath} — replace each REPLACE_ME placeholder`);
    console.log(`  2. Fill in workspace/ baseline files if your task depends on starting content`);
    console.log(`  3. Run: iso-eval run ${result.checksYmlPath}${runner ? ` --runner ${runner}` : ""}${harnessSource ? ` --harness-source ${harnessSource}` : ""}`);
  } else {
    console.log(`  1. Fill in workspace/ baseline files if your task depends on starting content`);
    console.log(`  2. Run: iso-eval run ${result.checksYmlPath}${runner ? ` --runner ${runner}` : ""}${harnessSource ? ` --harness-source ${harnessSource}` : ""}`);
  }
  return 0;
}

function cmdSources(): number {
  for (const r of defaultRoots()) {
    const marker = r.exists ? "✓" : "·";
    const note = r.harness === "opencode" ? "parser ready (sqlite db)" : "parser ready";
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

export interface ParsedModelScoreArgs {
  since?: string;
  sinceMs?: number;
  cwd?: string;
  tool?: string;
  harness?: HarnessName;
  json: boolean;
  failOnSchema: boolean;
  failOnModels: string[];
  error?: string;
}

export function parseModelScoreArgs(args: string[]): ParsedModelScoreArgs {
  const out: ParsedModelScoreArgs = {
    json: false,
    failOnSchema: false,
    failOnModels: [],
  };

  let usedSince = false;
  let usedSinceHours = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--since") {
      const value = args[++i];
      if (!value) {
        out.error = "iso-trace model-score: --since requires a value";
        return out;
      }
      if (usedSinceHours) {
        out.error = "iso-trace model-score: pass either --since or --since-hours, not both";
        return out;
      }
      out.since = value;
      usedSince = true;
    } else if (a === "--since-hours") {
      const raw = args[++i];
      const hours = Number(raw);
      if (!raw || !Number.isFinite(hours) || hours <= 0) {
        out.error = "iso-trace model-score: --since-hours must be a positive number";
        return out;
      }
      if (usedSince) {
        out.error = "iso-trace model-score: pass either --since or --since-hours, not both";
        return out;
      }
      out.sinceMs = Date.now() - hours * 3_600_000;
      out.since = new Date(out.sinceMs).toISOString();
      usedSinceHours = true;
    } else if (a === "--cwd") {
      out.cwd = args[++i];
      if (!out.cwd) {
        out.error = "iso-trace model-score: --cwd requires a value";
        return out;
      }
    } else if (a === "--tool") {
      out.tool = args[++i];
      if (!out.tool) {
        out.error = "iso-trace model-score: --tool requires a value";
        return out;
      }
    } else if (a === "--harness") {
      const raw = args[++i];
      if (raw !== "claude-code" && raw !== "codex" && raw !== "opencode") {
        out.error = "iso-trace model-score: --harness must be claude-code, codex, or opencode";
        return out;
      }
      out.harness = raw;
    } else if (a === "--fail-on-schema") {
      out.failOnSchema = true;
    } else if (a === "--fail-on-model") {
      const model = args[++i];
      if (!model) {
        out.error = "iso-trace model-score: --fail-on-model requires a provider/model value";
        return out;
      }
      out.failOnModels.push(model);
    } else if (a === "--json") {
      out.json = true;
    } else {
      out.error = `iso-trace model-score: unknown flag "${a}"`;
      return out;
    }
  }

  if (out.sinceMs === undefined) {
    try {
      out.sinceMs = parseSinceCutoff(out.since);
    } catch (error) {
      out.error = error instanceof Error ? error.message : String(error);
      return out;
    }
  }

  return out;
}

export function modelScoreFailureReasons(
  scores: ModelScore[],
  opts: Pick<ParsedModelScoreArgs, "failOnSchema" | "failOnModels">,
): string[] {
  const reasons: string[] = [];

  if (opts.failOnSchema) {
    const offenders = scores.filter((score) => score.schemaErrors > 0);
    if (offenders.length > 0) {
      reasons.push(
        `schema errors observed: ${offenders.map((score) => `${score.model} (${score.schemaErrors})`).join(", ")}`,
      );
    }
  }

  const blocked = new Set(opts.failOnModels.filter(Boolean));
  if (blocked.size > 0) {
    const offenders = scores.filter((score) => blocked.has(score.model) && score.calls > 0);
    if (offenders.length > 0) {
      reasons.push(
        `blocked models observed: ${offenders.map((score) => `${score.model} (${score.calls})`).join(", ")}`,
      );
    }
  }

  return reasons;
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

async function discoverModelScoreRefs(opts: ParsedModelScoreArgs): Promise<SessionRef[]> {
  if (opts.sinceMs === undefined) {
    return discoverSessions({ since: opts.since, cwd: opts.cwd, harness: opts.harness });
  }

  if (opts.harness === "claude-code" || opts.harness === "codex") {
    return discoverSessions({ since: opts.since, cwd: opts.cwd, harness: opts.harness });
  }

  if (opts.harness === "opencode") {
    return discoverSessions({ cwd: opts.cwd, harness: "opencode" });
  }

  const roots = defaultRoots();
  const opencodeRoots = roots.filter((root) => root.harness === "opencode").map((root) => root.root);
  const otherRoots = roots
    .filter((root) => root.harness !== "opencode" && root.harness !== "cursor")
    .map((root) => root.root);
  const [opencodeRefs, otherRefs] = await Promise.all([
    discoverSessions({ cwd: opts.cwd, harness: "opencode", roots: opencodeRoots }),
    discoverSessions({ since: opts.since, cwd: opts.cwd, roots: otherRoots }),
  ]);
  return [...opencodeRefs, ...otherRefs].sort((a, b) =>
    b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0,
  );
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

function formatModelScoreTable(scores: ModelScore[], tool?: string): string {
  const includeReadShapes = tool === "read";
  const header = includeReadShapes
    ? ["model", "sessions", "calls", "ok", "err", "schema", "filePath", "path", "file_path", "success", "latest"]
    : ["model", "sessions", "calls", "ok", "err", "schema", "success", "latest"];
  const rows = scores.map((score) => {
    const base = [
      shorten(score.model, 42),
      String(score.sessions),
      String(score.calls),
      String(score.completed),
      String(score.errors),
      String(score.schemaErrors),
    ];
    const tail = [formatPercent(score.successRate), score.latestAt];
    if (!includeReadShapes) return [...base, ...tail];
    return [
      ...base,
      String(score.readInputShapes.filePath),
      String(score.readInputShapes.path),
      String(score.readInputShapes.file_path),
      ...tail,
    ];
  });
  return formatTable([header, ...rows]);
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function compileRedactionPattern(raw: string | undefined, prefix: string): RegExp | Error {
  if (!raw) return new Error(`${prefix}: --redact-regex requires a pattern`);
  try {
    const parsed = new RegExp(raw);
    const flags = parsed.flags.includes("g") ? parsed.flags : `${parsed.flags}g`;
    return new RegExp(parsed.source, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`${prefix}: invalid --redact-regex: ${message}`);
  }
}

function runIsoEval(args: string[]): number {
  const direct = spawnSync("iso-eval", args, { stdio: "inherit", encoding: "utf8" });
  if (!(direct.error && "code" in direct.error && direct.error.code === "ENOENT")) {
    return direct.status ?? 1;
  }
  const fallback = spawnSync("npx", ["--no-install", "iso-eval", ...args], {
    stdio: "inherit",
    encoding: "utf8",
  });
  if (fallback.error && "code" in fallback.error && fallback.error.code === "ENOENT") {
    console.error("iso-trace export-fixture: could not find `iso-eval` on PATH (or via `npx --no-install`)");
    return 2;
  }
  return fallback.status ?? 1;
}

function sourceExists(path: string): boolean {
  const hash = path.indexOf("#session=");
  return existsSync(hash === -1 ? path : path.slice(0, hash));
}

function resolveSourcePath(path: string): string {
  const hash = path.indexOf("#session=");
  if (hash === -1) return resolve(path);
  return `${resolve(path.slice(0, hash))}${path.slice(hash)}`;
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

export async function main(argv: string[]): Promise<number> {
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
  if (cmd === "model-score") return cmdModelScore(rest);
  if (cmd === "export") return cmdExport(rest);
  if (cmd === "export-fixture") return cmdExportFixture(rest);
  if (cmd === "sources") return cmdSources();
  if (cmd === "where") return cmdWhere();
  console.error(`iso-trace: unknown command "${cmd}"\n`);
  console.error(USAGE);
  return 2;
}

function isDirectExecution(argv: string[]): boolean {
  const entry = argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution(process.argv)) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`iso-trace: ${msg}`);
      process.exit(1);
    },
  );
}

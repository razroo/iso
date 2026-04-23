import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  Event,
  FileOpEvent,
  Session,
  SessionRef,
  SourceInfo,
  TokenUsage,
  Turn,
} from "../types.js";

export const CURSOR_FORMAT = "cursor/jsonl-v1";

interface RawRecord {
  role?: "user" | "assistant" | "system" | string;
  message?: {
    content?: string | RawContentBlock[];
  };
}

type RawContentBlock =
  | { type?: "text"; text?: string }
  | { type?: "tool_use"; name?: string; input?: unknown }
  | Record<string, unknown>;

export function parseCursor(path: string): Session {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  const records = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as RawRecord;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${abs}:${i + 1}: invalid JSON — ${message}`);
      }
    });

  const source: SourceInfo = {
    harness: "cursor",
    format: CURSOR_FORMAT,
    path: abs,
  };
  const stat = statSync(abs);
  const startMs = safeStartMs(stat);
  const endMs = Math.max(startMs, safeEndMs(stat));
  const projectDir = findCursorProjectDir(abs) ?? dirname(abs);
  const cwd = readCursorWorkspacePath(projectDir);
  const tokenUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };
  const provisional: Array<Omit<Turn, "index" | "at">> = [];

  for (let i = 0; i < records.length; i++) {
    const events = recordToEvents(records[i], i);
    if (events.length === 0) continue;
    provisional.push({
      role: normaliseTurnRole(records[i].role),
      events,
    });
  }

  const turns: Turn[] = provisional.map((turn, index) => ({
    index,
    role: turn.role,
    at: turnAt(startMs, endMs, index, provisional.length),
    events: turn.events,
  }));

  return {
    id: deriveSessionId(abs, raw),
    source,
    cwd,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationMs: Math.max(0, endMs - startMs),
    turns,
    tokenUsage,
  };
}

export function refForCursor(path: string): SessionRef {
  const session = parseCursor(path);
  return {
    id: session.id,
    source: session.source,
    cwd: session.cwd,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    turnCount: session.turns.length,
    sizeBytes: Number(statSync(resolve(path)).size),
  };
}

function recordToEvents(record: RawRecord, turnIndex: number): Event[] {
  const role = normaliseMessageRole(record.role);
  const content = record.message?.content;
  const events: Event[] = [];
  let toolIndex = 0;

  if (typeof content === "string") {
    if (content) events.push({ kind: "message", role, text: content });
    return events;
  }
  if (!Array.isArray(content)) return events;

  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      events.push({ kind: "message", role, text: block.text });
      continue;
    }
    if (block.type !== "tool_use") continue;
    const name = typeof block.name === "string" ? block.name : "";
    const input = block.input;
    events.push({
      kind: "tool_call",
      id: `cursor-${turnIndex}-${toolIndex++}`,
      name,
      input,
    });
    for (const fileOp of deriveFileOps(name, input)) events.push(fileOp);
  }

  return events;
}

function deriveFileOps(name: string, input: unknown): FileOpEvent[] {
  if (name === "ApplyPatch" && typeof input === "string") {
    return deriveFileOpsFromPatch(input);
  }
  if (name === "ReadLints") {
    return extractReadLintPaths(input).map((path) => ({
      kind: "file_op",
      op: "read",
      path,
      tool: name,
    }));
  }

  const op = FILE_OP_FOR_TOOL[name];
  if (!op) return [];
  const path = derivePath(name, input);
  if (!path) return [];

  const event: FileOpEvent = {
    kind: "file_op",
    op,
    path,
    tool: name,
  };
  if (name === "Write" && isRecord(input) && typeof input.contents === "string") {
    event.bytesChanged = Buffer.byteLength(input.contents, "utf8");
  }
  return [event];
}

const FILE_OP_FOR_TOOL: Record<string, FileOpEvent["op"] | undefined> = {
  Read: "read",
  ReadFile: "read",
  Write: "write",
  Edit: "edit",
  StrReplace: "edit",
  Delete: "edit",
  Glob: "list",
  Grep: "search",
  SemanticSearch: "search",
  rg: "search",
};

function deriveFileOpsFromPatch(patch: string): FileOpEvent[] {
  const out: FileOpEvent[] = [];
  const normalised = normalisePatchText(patch);
  const pattern = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
  for (const match of normalised.matchAll(pattern)) {
    const kind = match[1];
    const path = match[2]?.trim();
    if (!path) continue;
    out.push({
      kind: "file_op",
      op: kind === "Add" ? "write" : "edit",
      path,
      tool: "ApplyPatch",
    });
  }
  return out;
}

function normalisePatchText(patch: string): string {
  if (patch.includes("\n")) return patch;
  return patch.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

function derivePath(name: string, input: unknown): string {
  if (!isRecord(input)) return "";

  if (name === "Glob") {
    const dir = typeof input.target_directory === "string" ? input.target_directory : "";
    const pattern = typeof input.glob_pattern === "string" ? input.glob_pattern : "";
    if (dir && pattern) return `${dir.replace(/\/+$/, "")}/${pattern.replace(/^\/+/, "")}`;
    return dir || pattern;
  }

  if (name === "SemanticSearch") {
    const dirs = parseStringArray(input.target_directories);
    if (dirs.length > 0) return dirs[0];
    return typeof input.query === "string" ? input.query : "";
  }

  return (
    (typeof input.path === "string" && input.path) ||
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.filePath === "string" && input.filePath) ||
    (typeof input.target_directory === "string" && input.target_directory) ||
    ""
  );
}

function extractReadLintPaths(input: unknown): string[] {
  if (!isRecord(input)) return [];
  if (Array.isArray(input.paths)) {
    return input.paths.filter((value): value is string => typeof value === "string" && !!value);
  }
  const single =
    (typeof input.path === "string" && input.path) ||
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.filePath === "string" && input.filePath) ||
    "";
  return single ? [single] : [];
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && !!item);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && !!item);
  } catch {
    return [];
  }
}

function findCursorProjectDir(path: string): string | undefined {
  let current = dirname(path);
  while (true) {
    if (existsSync(join(current, ".workspace-trusted")) || existsSync(join(current, "worker.log"))) {
      return current;
    }
    if (basename(current) === "agent-transcripts") {
      return dirname(current);
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readCursorWorkspacePath(projectDir: string): string {
  const trusted = join(projectDir, ".workspace-trusted");
  if (existsSync(trusted)) {
    try {
      const parsed = JSON.parse(readFileSync(trusted, "utf8")) as { workspacePath?: unknown };
      if (typeof parsed.workspacePath === "string" && parsed.workspacePath) {
        return parsed.workspacePath;
      }
    } catch {
      // fall through
    }
  }

  const workerLog = join(projectDir, "worker.log");
  if (existsSync(workerLog)) {
    const raw = readFileSync(workerLog, "utf8");
    const matches = [...raw.matchAll(/workspacePath=([^\n\r]+)/g)];
    const candidate = matches.at(-1)?.[1]?.trim();
    if (candidate) return candidate;
  }

  return "";
}

function safeStartMs(stat: { birthtimeMs: number; mtimeMs: number }): number {
  const birth = Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtimeMs : NaN;
  const modified = Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0 ? stat.mtimeMs : 0;
  if (!Number.isFinite(birth)) return modified;
  return Math.min(birth, modified);
}

function safeEndMs(stat: { mtimeMs: number }): number {
  return Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0 ? stat.mtimeMs : 0;
}

function turnAt(startMs: number, endMs: number, index: number, count: number): string {
  if (count <= 1 || endMs <= startMs) return new Date(startMs).toISOString();
  const step = (endMs - startMs) / Math.max(count - 1, 1);
  return new Date(startMs + step * index).toISOString();
}

function deriveSessionId(path: string, raw: string): string {
  const firstLine = raw.slice(0, Math.min(raw.length, 4096)).split(/\r?\n/)[0] ?? "";
  const hash = createHash("sha256").update(path).update("\x00").update(firstLine).digest("hex");
  return `cu_${basename(path, ".jsonl").slice(0, 8)}_${hash.slice(0, 8)}`;
}

function normaliseTurnRole(role: unknown): Turn["role"] {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "tool";
}

function normaliseMessageRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "assistant";
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

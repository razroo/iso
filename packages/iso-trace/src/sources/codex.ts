import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type {
  Event,
  FileOpEvent,
  FileOpKind,
  Session,
  SessionRef,
  SourceInfo,
  TokenUsage,
  Turn,
} from "../types.js";

export const CODEX_FORMAT = "codex/jsonl-v1";

interface RawRecord {
  timestamp?: string;
  type?: string;
  payload?: unknown;
}

interface ToolCallPayload {
  name?: string;
  arguments?: string;
  call_id?: string;
}

interface ToolResultPayload {
  call_id?: string;
  output?: string;
}

export function parseCodex(path: string): Session {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  const records = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as RawRecord;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${abs}:${i + 1}: invalid JSON — ${msg}`);
      }
    });

  let nativeId: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  const tokenUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };
  const turns: Turn[] = [];

  for (const rec of records) {
    if (rec.timestamp) {
      if (!startedAt || rec.timestamp < startedAt) startedAt = rec.timestamp;
      if (!endedAt || rec.timestamp > endedAt) endedAt = rec.timestamp;
    }

    if (rec.type === "session_meta" && isRecord(rec.payload)) {
      if (typeof rec.payload.id === "string" && rec.payload.id) nativeId = rec.payload.id;
      if (typeof rec.payload.cwd === "string" && rec.payload.cwd) cwd = rec.payload.cwd;
      if (typeof rec.payload.timestamp === "string" && rec.payload.timestamp) {
        if (!startedAt || rec.payload.timestamp < startedAt) startedAt = rec.payload.timestamp;
      }
      continue;
    }

    if (rec.type === "turn_context" && isRecord(rec.payload)) {
      if (typeof rec.payload.cwd === "string" && rec.payload.cwd) cwd = rec.payload.cwd;
      if (typeof rec.payload.model === "string" && rec.payload.model) model = rec.payload.model;
      continue;
    }

    const events = recordToEvents(rec, tokenUsage);
    if (events.length === 0 || !rec.timestamp) continue;

    turns.push({
      index: turns.length,
      role: deriveTurnRole(rec),
      at: rec.timestamp,
      events,
    });
  }

  const id = nativeId ?? deriveSessionId(abs, raw);
  const startMs = startedAt ? Date.parse(startedAt) : 0;
  const endMs = endedAt ? Date.parse(endedAt) : startMs;
  const source: SourceInfo = {
    harness: "codex",
    format: CODEX_FORMAT,
    path: abs,
  };

  const session: Session = {
    id,
    source,
    cwd: cwd ?? "",
    startedAt: startedAt ?? new Date(0).toISOString(),
    durationMs: Math.max(0, endMs - startMs),
    turns,
    tokenUsage,
  };
  if (endedAt) session.endedAt = endedAt;
  if (model) session.model = model;
  return session;
}

export function refForCodex(path: string): SessionRef {
  const session = parseCodex(path);
  return {
    id: session.id,
    source: session.source,
    cwd: session.cwd,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    turnCount: session.turns.length,
    sizeBytes: statSync(path).size,
  };
}

function recordToEvents(rec: RawRecord, usageAccum: TokenUsage): Event[] {
  if (rec.type === "response_item" && isRecord(rec.payload)) {
    return responseItemToEvents(rec.payload);
  }
  if (
    rec.type === "event_msg" &&
    isRecord(rec.payload) &&
    rec.payload.type === "token_count" &&
    isRecord(rec.payload.info) &&
    isRecord(rec.payload.info.last_token_usage)
  ) {
    const last = rec.payload.info.last_token_usage;
    const input = num(last.input_tokens);
    const output = num(last.output_tokens);
    const cacheRead = num(last.cached_input_tokens);
    usageAccum.input += input;
    usageAccum.output += output;
    usageAccum.cacheRead += cacheRead;
    return [
      {
        kind: "token_usage",
        input,
        output,
        cacheRead,
        cacheCreated: 0,
      },
    ];
  }
  return [];
}

function responseItemToEvents(payload: Record<string, any>): Event[] {
  if (payload.type === "message") return messageToEvents(payload);
  if (payload.type === "function_call") return functionCallToEvents(payload as ToolCallPayload);
  if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    const out = payload as ToolResultPayload;
    return [
      {
        kind: "tool_result",
        toolUseId: typeof out.call_id === "string" ? out.call_id : "",
        output: typeof out.output === "string" ? out.output : "",
      },
    ];
  }
  return [];
}

function messageToEvents(payload: Record<string, any>): Event[] {
  const role = normaliseMessageRole(payload.role);
  const content = Array.isArray(payload.content) ? payload.content : [];
  const texts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if ((item.type === "input_text" || item.type === "output_text") && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  const text = texts.join("\n").trim();
  return text ? [{ kind: "message", role, text }] : [];
}

function functionCallToEvents(payload: ToolCallPayload): Event[] {
  const name = payload.name ?? "";
  const input = parseArguments(payload.arguments);
  const events: Event[] = [
    {
      kind: "tool_call",
      id: payload.call_id ?? "",
      name,
      input,
    },
  ];
  for (const op of deriveFileOps(name, input)) events.push(op);
  return events;
}

function deriveFileOps(name: string, input: unknown): FileOpEvent[] {
  if (name === "apply_patch" && typeof input === "string") {
    return deriveFileOpsFromPatch(input);
  }
  if (name === "exec_command" && isRecord(input)) {
    return deriveFileOpsFromExecParams(input);
  }
  if (name === "multi_tool_use.parallel" && isRecord(input) && Array.isArray(input.tool_uses)) {
    const out: FileOpEvent[] = [];
    for (const item of input.tool_uses) {
      if (!isRecord(item)) continue;
      if (item.recipient_name === "functions.exec_command" && isRecord(item.parameters)) {
        out.push(...deriveFileOpsFromExecParams(item.parameters));
      }
    }
    return out;
  }
  return [];
}

function deriveFileOpsFromPatch(patch: string): FileOpEvent[] {
  const out: FileOpEvent[] = [];
  const pattern = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
  for (const match of patch.matchAll(pattern)) {
    const kind = match[1];
    const path = match[2]?.trim();
    if (!path) continue;
    out.push({
      kind: "file_op",
      op: kind === "Add" ? "write" : "edit",
      path,
      tool: "apply_patch",
    });
  }
  return out;
}

function deriveFileOpsFromExecParams(params: Record<string, any>): FileOpEvent[] {
  const cmd = typeof params.cmd === "string" ? params.cmd.trim() : "";
  const workdir = typeof params.workdir === "string" ? params.workdir : undefined;
  if (!cmd) return [];

  if (/^(ls|find)\b/.test(cmd)) {
    return [
      {
        kind: "file_op",
        op: "list",
        path: resolveCandidatePath(extractCandidatePaths(cmd, workdir)[0] ?? workdir ?? ".", workdir),
        tool: "exec_command",
      },
    ];
  }

  if (/^(rg|grep)\b/.test(cmd)) {
    const op: FileOpKind = /\brg\b[^\n]*\s--files\b/.test(cmd) ? "list" : "search";
    return [
      {
        kind: "file_op",
        op,
        path: resolveCandidatePath(extractCandidatePaths(cmd, workdir)[0] ?? workdir ?? ".", workdir),
        tool: "exec_command",
      },
    ];
  }

  if (/^(sed|cat|head|tail|nl|wc)\b/.test(cmd)) {
    return extractCandidatePaths(cmd, workdir)
      .slice(0, 4)
      .map((path) => ({
        kind: "file_op" as const,
        op: "read" as const,
        path,
        tool: "exec_command",
      }));
  }

  return [];
}

function extractCandidatePaths(cmd: string, workdir?: string): string[] {
  const tokens = cmd.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  const out = new Set<string>();
  for (const raw of tokens) {
    const token = stripQuotes(raw);
    if (!looksLikePath(token)) continue;
    out.add(resolveCandidatePath(token, workdir));
  }
  return [...out];
}

function resolveCandidatePath(path: string, workdir?: string): string {
  if (!workdir || path.startsWith("/") || path.startsWith("~")) return path;
  return resolve(workdir, path);
}

function looksLikePath(token: string): boolean {
  if (!token || token.startsWith("-")) return false;
  if (token === "." || token === "..") return true;
  if (token.includes("/") || token.includes("\\")) return true;
  return /\.(md|txt|json|jsonl|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|sh|py|rs|go|rb|java|swift|kt|sql|html|css|svg)$/.test(
    token,
  );
}

function stripQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function deriveTurnRole(rec: RawRecord): Turn["role"] {
  if (rec.type === "response_item" && isRecord(rec.payload)) {
    if (rec.payload.type === "message") return normaliseTurnRole(rec.payload.role);
    if (rec.payload.type === "function_call") return "assistant";
    if (rec.payload.type === "function_call_output" || rec.payload.type === "custom_tool_call_output") {
      return "tool";
    }
  }
  if (rec.type === "event_msg" && isRecord(rec.payload) && rec.payload.type === "token_count") {
    return "assistant";
  }
  return "tool";
}

function normaliseTurnRole(role: unknown): Turn["role"] {
  if (role === "user" || role === "assistant" || role === "system") return role;
  if (role === "developer") return "system";
  return "tool";
}

function normaliseMessageRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "system";
}

function parseArguments(raw: string | undefined): unknown {
  if (typeof raw !== "string") return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function deriveSessionId(path: string, raw: string): string {
  const firstLine = raw.slice(0, Math.min(raw.length, 4096)).split(/\r?\n/)[0] ?? "";
  const h = createHash("sha256").update(path).update("\x00").update(firstLine).digest("hex");
  return `cx_${basename(path, ".jsonl").slice(0, 8)}_${h.slice(0, 8)}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

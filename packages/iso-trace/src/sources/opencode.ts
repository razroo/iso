import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  Event,
  FileOpEvent,
  Session,
  SessionRef,
  SourceInfo,
  TokenUsage,
  Turn,
} from "../types.js";

export const OPENCODE_EXPORT_FORMAT = "opencode/export-json-v1";
export const OPENCODE_SQLITE_FORMAT = "opencode/sqlite-v1";

interface OpenCodeExport {
  info?: OpenCodeSessionInfo;
  messages?: OpenCodeMessage[];
}

interface OpenCodeSessionInfo {
  id?: string;
  directory?: string;
  title?: string;
  version?: string;
  time?: { created?: number; updated?: number };
}

interface OpenCodeMessage {
  info?: Record<string, any>;
  parts?: Record<string, any>[];
}

export interface OpenCodeSessionRow {
  id: string;
  directory: string;
  title?: string | null;
  time_created: number;
  time_updated: number;
  turn_count?: number;
  size_bytes?: number;
}

export function defaultOpenCodeDbPath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

export function openCodeSessionLocator(sessionId: string, dbPath: string = defaultOpenCodeDbPath()): string {
  return `${resolve(dbPath)}#session=${encodeURIComponent(sessionId)}`;
}

export function isOpenCodeLocator(path: string): boolean {
  return /#session=/.test(path);
}

export function discoverOpenCodeSessionRefs(dbPath: string): SessionRef[] {
  if (resolve(dbPath) !== resolve(defaultOpenCodeDbPath())) {
    throw new Error(`iso-trace: custom OpenCode DB roots are not supported yet (${dbPath})`);
  }
  const rows = queryOpenCodeDb(
    [
      "select",
      "  s.id,",
      "  s.directory,",
      "  s.title,",
      "  s.time_created,",
      "  s.time_updated,",
      "  (select count(*) from message m where m.session_id = s.id) as turn_count,",
      "  (",
      "    (select coalesce(sum(length(data)), 0) from message m where m.session_id = s.id) +",
      "    (select coalesce(sum(length(data)), 0) from part p where p.session_id = s.id)",
      "  ) as size_bytes",
      "from session s",
      "where s.time_archived is null",
      "order by s.time_updated desc",
    ].join(" "),
  ) as OpenCodeSessionRow[];
  return sessionRefsFromOpenCodeRows(rows, dbPath);
}

export function sessionRefsFromOpenCodeRows(rows: OpenCodeSessionRow[], dbPath: string): SessionRef[] {
  return rows
    .sort((a, b) => b.time_updated - a.time_updated)
    .map((row) => ({
      id: row.id,
      source: {
        harness: "opencode",
        format: OPENCODE_SQLITE_FORMAT,
        path: openCodeSessionLocator(row.id, dbPath),
      },
      cwd: row.directory,
      startedAt: msToIso(row.time_created),
      endedAt: msToIso(row.time_updated),
      turnCount: row.turn_count ?? 0,
      sizeBytes: row.size_bytes ?? 0,
    }));
}

export function parseOpenCode(path: string): Session {
  if (isOpenCodeLocator(path)) {
    return parseOpenCodeExportText(readOpenCodeExport(sessionIdFromLocator(path)), path, OPENCODE_SQLITE_FORMAT);
  }
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  return parseOpenCodeExportText(raw, abs, OPENCODE_EXPORT_FORMAT);
}

export function refForOpenCode(path: string): SessionRef {
  const session = parseOpenCode(path);
  const sizeBytes = isOpenCodeLocator(path) ? 0 : statSync(resolve(path)).size;
  return {
    id: session.id,
    source: session.source,
    cwd: session.cwd,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    turnCount: session.turns.length,
    sizeBytes,
  };
}

export function looksLikeOpenCodeExport(raw: string): boolean {
  const json = extractJsonDocument(raw);
  if (!json) return false;
  try {
    const parsed = JSON.parse(json) as OpenCodeExport;
    return !!parsed && typeof parsed === "object" && !!parsed.info && Array.isArray(parsed.messages);
  } catch {
    return false;
  }
}

function parseOpenCodeExportText(raw: string, sourcePath: string, format: string): Session {
  const json = extractJsonDocument(raw);
  if (!json) throw new Error(`iso-trace: could not find OpenCode export JSON in ${sourcePath}`);
  const parsed = JSON.parse(json) as OpenCodeExport;
  const info = parsed.info ?? {};
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const tokenUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };
  const turns: Turn[] = [];

  for (const message of messages) {
    const turn = messageToTurn(message, tokenUsage);
    if (turn) turns.push({ ...turn, index: turns.length });
  }

  const startedAtMs = typeof info.time?.created === "number" ? info.time.created : messages[0]?.info?.time?.created;
  const endedAtMs = typeof info.time?.updated === "number" ? info.time.updated : messages[messages.length - 1]?.info?.time?.completed;
  const firstAssistant = messages.find((m) => m.info?.role === "assistant");
  const source: SourceInfo = {
    harness: "opencode",
    format,
    path: sourcePath,
  };

  const session: Session = {
    id: typeof info.id === "string" && info.id ? info.id : sourcePath,
    source,
    cwd: typeof info.directory === "string" ? info.directory : "",
    startedAt: msToIso(startedAtMs ?? 0),
    durationMs: Math.max(0, (endedAtMs ?? startedAtMs ?? 0) - (startedAtMs ?? 0)),
    turns,
    tokenUsage,
  };
  if (endedAtMs !== undefined) session.endedAt = msToIso(endedAtMs);
  if (firstAssistant?.info?.modelID) {
    const provider = typeof firstAssistant.info.providerID === "string" ? `${firstAssistant.info.providerID}/` : "";
    session.model = `${provider}${firstAssistant.info.modelID}`;
  }
  return session;
}

function messageToTurn(message: OpenCodeMessage, usageAccum: TokenUsage): Omit<Turn, "index"> | null {
  const info = isRecord(message.info) ? message.info : {};
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const role = normaliseTurnRole(info.role);
  const created = typeof info.time?.created === "number" ? info.time.created : 0;
  const events: Event[] = [];

  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string" && part.text) {
      events.push({ kind: "message", role: normaliseMessageRole(info.role), text: part.text });
      continue;
    }
    if (part.type === "tool") {
      for (const event of toolPartToEvents(part)) events.push(event);
      continue;
    }
    if (part.type === "patch" && Array.isArray(part.files)) {
      for (const file of part.files) {
        if (typeof file !== "string" || !file) continue;
        events.push({ kind: "file_op", op: "edit", path: file, tool: "patch" });
      }
    }
  }

  if (events.length === 0 && info.role === "assistant" && isRecord(info.error)) {
    const detail = extractOpenCodeError(info.error);
    if (detail) events.push({ kind: "message", role: "assistant", text: detail });
  }

  if (isRecord(info.tokens)) {
    const cache = isRecord(info.tokens.cache) ? info.tokens.cache : {};
    const input = num(info.tokens.input);
    const output = num(info.tokens.output);
    const cacheRead = num(cache.read);
    const cacheCreated = num(cache.write);
    const provider =
      typeof info.providerID === "string" && info.providerID ? `${info.providerID}/` : "";
    usageAccum.input += input;
    usageAccum.output += output;
    usageAccum.cacheRead += cacheRead;
    usageAccum.cacheCreated += cacheCreated;
    events.push({
      kind: "token_usage",
      input,
      output,
      cacheRead,
      cacheCreated,
      model: typeof info.modelID === "string" ? `${provider}${info.modelID}` : undefined,
    });
  }

  if (events.length === 0) return null;
  return {
    role,
    at: msToIso(created),
    events,
  };
}

function toolPartToEvents(part: Record<string, any>): Event[] {
  const tool = typeof part.tool === "string" ? part.tool : "";
  const callId = typeof part.callID === "string" ? part.callID : "";
  const state = isRecord(part.state) ? part.state : {};
  const input = state.input ?? {};
  const output = state.output;
  const events: Event[] = [
    {
      kind: "tool_call",
      id: callId,
      name: tool,
      input,
    },
  ];
  for (const fileOp of deriveFileOpsFromOpenCodeTool(tool, input)) events.push(fileOp);
  events.push({
    kind: "tool_result",
    toolUseId: callId,
    output: stringifyValue(output),
    error: state.status === "error" || state.status === "failed" ? stringifyValue(state.error ?? output) : undefined,
  });
  return events;
}

function deriveFileOpsFromOpenCodeTool(tool: string, input: unknown): FileOpEvent[] {
  if (!isRecord(input)) return [];
  const path =
    (typeof input.filePath === "string" && input.filePath) ||
    (typeof input.path === "string" && input.path) ||
    (typeof input.pattern === "string" && input.pattern) ||
    "";
  if (!path) return [];

  const map: Record<string, FileOpEvent["op"] | undefined> = {
    read: "read",
    write: "write",
    edit: "edit",
    glob: "list",
    grep: "search",
  };
  const op = map[tool];
  if (!op) return [];

  const event: FileOpEvent = {
    kind: "file_op",
    op,
    path,
    tool,
  };
  if (tool === "write" && typeof input.content === "string") {
    event.bytesChanged = Buffer.byteLength(input.content, "utf8");
  }
  return [event];
}

function readOpenCodeExport(sessionId: string): string {
  const result = spawnSync("opencode", ["export", sessionId], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if ((result.status ?? 0) !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    throw new Error(`iso-trace: opencode export ${sessionId} failed: ${detail}`);
  }
  return result.stdout ?? "";
}

function queryOpenCodeDb(sql: string): unknown[] {
  const result = runOpenCodeDbQuery(sql);
  if ((result.status ?? 0) !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    throw new Error(`iso-trace: opencode db query failed: ${detail}`);
  }
  return JSON.parse(result.stdout || "[]") as unknown[];
}

function runOpenCodeDbQuery(sql: string): SpawnSyncReturns<string> {
  let lastResult: SpawnSyncReturns<string> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync("opencode", ["db", sql, "--format", "json"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if ((result.status ?? 0) === 0) return result;
    lastResult = result;
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    if (!isRetryableSqliteError(detail)) return result;
  }
  return lastResult ?? spawnSync("opencode", ["db", sql, "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function isRetryableSqliteError(detail: string): boolean {
  return /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(detail);
}

function sessionIdFromLocator(path: string): string {
  const match = path.match(/#session=([^#]+)$/);
  if (!match) throw new Error(`iso-trace: invalid OpenCode session locator "${path}"`);
  return decodeURIComponent(match[1]);
}

function extractJsonDocument(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

function extractOpenCodeError(error: Record<string, any>): string {
  if (isRecord(error.data) && typeof error.data.message === "string" && error.data.message) {
    return `Error: ${error.data.message}`;
  }
  if (typeof error.message === "string" && error.message) return `Error: ${error.message}`;
  return "";
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normaliseTurnRole(role: unknown): Turn["role"] {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "tool";
}

function normaliseMessageRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "assistant";
}

function msToIso(value: number): string {
  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

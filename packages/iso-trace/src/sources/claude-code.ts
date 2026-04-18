import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
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

export const CLAUDE_CODE_FORMAT = "claude-code/jsonl-v1";

// Tool-name → derived FileOp mapping. Reduced to the file-touching tools
// we care about for aggregate stats; other tools still surface as
// ToolCallEvents and are picked up by tool-level queries.
const FILE_OP_FOR_TOOL: Record<string, FileOpKind | undefined> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  NotebookEdit: "edit",
  Glob: "list",
  Grep: "search",
};

interface RawRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  gitBranch?: string;
  version?: string;
  message?: RawMessage;
  isSidechain?: boolean;
}

interface RawMessage {
  role?: "user" | "assistant" | "system";
  model?: string;
  content?: string | RawContentBlock[];
  usage?: RawUsage;
  stop_reason?: string;
}

type RawContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean };

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function parseClaudeCode(path: string): Session {
  const abs = path;
  const raw = readFileSync(abs, "utf8");
  const records = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as RawRecord;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${abs}:${i + 1}: invalid JSON — ${msg}`);
      }
    });

  const source: SourceInfo = {
    harness: "claude-code",
    format: CLAUDE_CODE_FORMAT,
    path: abs,
  };
  const id = deriveSessionId(abs, raw);

  let cwd: string | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  const tokenUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 };
  const turns: Turn[] = [];

  for (const rec of records) {
    if (!rec.timestamp) continue;
    if (!startedAt || rec.timestamp < startedAt) startedAt = rec.timestamp;
    if (!endedAt || rec.timestamp > endedAt) endedAt = rec.timestamp;
    if (!cwd && typeof rec.cwd === "string") cwd = rec.cwd;

    const events = recordToEvents(rec, tokenUsage);
    if (events.length === 0) continue;

    if (!model) {
      for (const e of events) {
        if (e.kind === "token_usage" && e.model) {
          model = e.model;
          break;
        }
      }
    }

    turns.push({
      index: turns.length,
      role: deriveTurnRole(rec),
      at: rec.timestamp,
      events,
    });
  }

  const startMs = startedAt ? Date.parse(startedAt) : 0;
  const endMs = endedAt ? Date.parse(endedAt) : startMs;
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

export function refForClaudeCode(path: string): SessionRef {
  const session = parseClaudeCode(path);
  const size = statSync(path).size;
  const ref: SessionRef = {
    id: session.id,
    source: session.source,
    cwd: session.cwd,
    startedAt: session.startedAt,
    turnCount: session.turns.length,
    sizeBytes: size,
  };
  if (session.endedAt) ref.endedAt = session.endedAt;
  return ref;
}

function recordToEvents(rec: RawRecord, usageAccum: TokenUsage): Event[] {
  const events: Event[] = [];
  const msg = rec.message;
  if (!msg) return events;
  const content = msg.content;

  if (msg.role === "system" || rec.type === "system") {
    const text = typeof content === "string" ? content : stringifyBlocks(content);
    if (text) events.push({ kind: "message", role: "system", text });
    return events;
  }

  if (msg.role === "user" || rec.type === "user") {
    if (typeof content === "string") {
      if (content) events.push({ kind: "message", role: "user", text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && block.text) {
          events.push({ kind: "message", role: "user", text: block.text });
        } else if (block.type === "tool_result") {
          const output = stringifyToolResultContent(block.content);
          const evt: ToolResult = {
            kind: "tool_result",
            toolUseId: block.tool_use_id ?? "",
            output,
          };
          if (block.is_error) evt.error = "tool reported error";
          events.push(evt);
        }
      }
    }
    return events;
  }

  if (msg.role === "assistant" || rec.type === "assistant") {
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && block.text) {
          events.push({ kind: "message", role: "assistant", text: block.text });
        } else if (block.type === "tool_use") {
          const name = block.name ?? "";
          const input = block.input;
          events.push({
            kind: "tool_call",
            id: block.id ?? "",
            name,
            input,
          });
          const fileOp = deriveFileOp(name, input);
          if (fileOp) events.push(fileOp);
        }
        // thinking blocks intentionally skipped in v0.1
      }
    }
    if (msg.usage) {
      const u = msg.usage;
      const input = num(u.input_tokens);
      const output = num(u.output_tokens);
      const cacheRead = num(u.cache_read_input_tokens);
      const cacheCreated = num(u.cache_creation_input_tokens);
      usageAccum.input += input;
      usageAccum.output += output;
      usageAccum.cacheRead += cacheRead;
      usageAccum.cacheCreated += cacheCreated;
      const evt: TokenUsageEventLite = {
        kind: "token_usage",
        input,
        output,
        cacheRead,
        cacheCreated,
      };
      if (msg.model) evt.model = msg.model;
      events.push(evt);
    }
    return events;
  }

  return events;
}

type ToolResult = Extract<Event, { kind: "tool_result" }>;
type TokenUsageEventLite = Extract<Event, { kind: "token_usage" }>;

function deriveTurnRole(rec: RawRecord): Turn["role"] {
  const r = rec.message?.role;
  if (r === "user" || r === "assistant" || r === "system") return r;
  if (rec.type === "user") return "user";
  if (rec.type === "assistant") return "assistant";
  return "tool";
}

function deriveFileOp(tool: string, input: unknown): FileOpEvent | undefined {
  const op = FILE_OP_FOR_TOOL[tool];
  if (!op) return undefined;
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const path =
    (typeof i.file_path === "string" && i.file_path) ||
    (typeof i.path === "string" && i.path) ||
    (typeof i.pattern === "string" && i.pattern) ||
    (typeof i.notebook_path === "string" && i.notebook_path) ||
    "";
  if (!path) return undefined;
  const evt: FileOpEvent = { kind: "file_op", op, path, tool };
  if (tool === "Write" && typeof i.content === "string") {
    evt.bytesChanged = Buffer.byteLength(i.content, "utf8");
  }
  return evt;
}

function stringifyBlocks(content: string | RawContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === "object" && b.type === "text" && b.text) parts.push(b.text);
  }
  return parts.join("\n");
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (b && typeof b === "object") {
        const block = b as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
      }
    }
    return parts.join("\n");
  }
  if (content === undefined || content === null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function deriveSessionId(path: string, firstBytes: string): string {
  const firstLine = firstBytes.slice(0, Math.min(firstBytes.length, 4096)).split(/\r?\n/)[0] ?? "";
  const h = createHash("sha256").update(path).update("\x00").update(firstLine).digest("hex");
  return `cc_${basename(path, ".jsonl").slice(0, 8)}_${h.slice(0, 8)}`;
}

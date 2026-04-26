import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GuardEvent } from "./types.js";

export function loadEvents(path: string): GuardEvent[] {
  const sourcePath = resolve(path);
  const raw = readFileSync(sourcePath, "utf8");
  return parseEventsText(raw, sourcePath);
}

export function parseEventsText(raw: string, sourcePath = "<inline>"): GuardEvent[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (looksLikeJsonl(trimmed)) {
    const values = trimmed
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, i) => parseJson(line, `${sourcePath}:${i + 1}`));
    return normalizeEventInput(values, sourcePath);
  }

  return normalizeEventInput(parseJson(trimmed, sourcePath), sourcePath);
}

export function normalizeEventInput(raw: unknown, sourcePath = "<inline>"): GuardEvent[] {
  if (Array.isArray(raw)) {
    const events = raw
      .filter((entry) => !isSessionHeader(entry))
      .map((entry, i) => normalizeOneEvent(entry, i, sourcePath))
      .filter((event): event is GuardEvent => event !== null);
    return withIndexes(events);
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.turns)) return flattenIsoTraceSession(record, sourcePath);
    if (Array.isArray(record.events)) return normalizeEventInput(record.events, sourcePath);
  }

  throw new Error(`${sourcePath}: events must be a JSON array, JSONL stream, or iso-trace session export`);
}

function looksLikeJsonl(raw: string): boolean {
  const first = raw[0];
  if (first === "[" || first === "{") {
    try {
      JSON.parse(raw);
      return false;
    } catch {
      return raw.includes("\n");
    }
  }
  return raw.includes("\n");
}

function parseJson(raw: string, where: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${where}: invalid JSON: ${message}`);
  }
}

function flattenIsoTraceSession(raw: Record<string, unknown>, sourcePath: string): GuardEvent[] {
  const events: GuardEvent[] = [];
  const turns = raw.turns as unknown[];
  for (const turnRaw of turns) {
    if (!turnRaw || typeof turnRaw !== "object" || Array.isArray(turnRaw)) continue;
    const turn = turnRaw as Record<string, unknown>;
    const turnIndex = typeof turn.index === "number" ? turn.index : undefined;
    const role = typeof turn.role === "string" ? turn.role : undefined;
    const at = typeof turn.at === "string" ? turn.at : undefined;
    const turnEvents = Array.isArray(turn.events) ? turn.events : [];
    for (const eventRaw of turnEvents) {
      const normalized = normalizeIsoTraceEvent(eventRaw, {
        at,
        role,
        turnIndex,
        source: sourcePath,
      });
      if (normalized) events.push(normalized);
    }
  }
  return withIndexes(events);
}

function normalizeIsoTraceEvent(
  raw: unknown,
  meta: { at?: string; role?: string; turnIndex?: number; source: string },
): GuardEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const event = raw as Record<string, unknown>;
  const kind = typeof event.kind === "string" ? event.kind : undefined;
  if (!kind) return null;

  const data: Record<string, unknown> = {
    ...event,
    role: meta.role,
    turnIndex: meta.turnIndex,
  };
  if (kind === "message") {
    return {
      type: "message",
      name: typeof event.role === "string" ? event.role : meta.role,
      at: meta.at,
      text: typeof event.text === "string" ? event.text : undefined,
      source: `turn:${meta.turnIndex ?? "?"}`,
      data,
    };
  }
  if (kind === "tool_call") {
    return {
      type: "tool_call",
      name: typeof event.name === "string" ? event.name : undefined,
      at: meta.at,
      text: event.input === undefined ? undefined : safeJson(event.input),
      source: `turn:${meta.turnIndex ?? "?"}`,
      data,
    };
  }
  if (kind === "tool_result") {
    return {
      type: "tool_result",
      name: typeof event.toolUseId === "string" ? event.toolUseId : undefined,
      at: meta.at,
      text: typeof event.output === "string" ? event.output : undefined,
      source: `turn:${meta.turnIndex ?? "?"}`,
      data,
    };
  }
  if (kind === "file_op") {
    return {
      type: "file_op",
      name: typeof event.op === "string" ? event.op : undefined,
      at: meta.at,
      text: typeof event.path === "string" ? event.path : undefined,
      source: `turn:${meta.turnIndex ?? "?"}`,
      data,
    };
  }
  return {
    type: kind,
    name: typeof event.name === "string" ? event.name : undefined,
    at: meta.at,
    source: `turn:${meta.turnIndex ?? "?"}`,
    data,
  };
}

function normalizeOneEvent(raw: unknown, index: number, sourcePath: string): GuardEvent | null {
  if (isSessionHeader(raw)) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${sourcePath}: event ${index} must be an object`);
  }
  const record = raw as Record<string, unknown>;
  if (record.type === "event" && typeof record.kind === "string") {
    return normalizeIsoTraceJsonlEvent(record, index, sourcePath);
  }
  const type = typeof record.type === "string"
    ? record.type
    : typeof record.kind === "string"
      ? record.kind
      : undefined;
  if (!type) throw new Error(`${sourcePath}: event ${index} missing type`);

  const data = normalizeData(record.data, record);
  return {
    type,
    name: optionalString(record.name),
    at: optionalString(record.at),
    text: optionalString(record.text),
    group: optionalStringOrNumber(record.group),
    index: typeof record.index === "number" ? record.index : index,
    source: optionalString(record.source) ?? sourcePath,
    data,
  };
}

function normalizeIsoTraceJsonlEvent(record: Record<string, unknown>, index: number, sourcePath: string): GuardEvent {
  const event = normalizeIsoTraceEvent(record, {
    at: optionalString(record.at),
    role: optionalString(record.role),
    turnIndex: typeof record.turnIndex === "number" ? record.turnIndex : undefined,
    source: sourcePath,
  });
  if (!event) throw new Error(`${sourcePath}: iso-trace JSONL event ${index} missing kind`);
  return event;
}

function isSessionHeader(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).type === "session");
}

function normalizeData(raw: unknown, full: Record<string, unknown>): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(full)) {
    if (["type", "kind", "name", "at", "text", "group", "index", "source"].includes(key)) continue;
    data[key] = value;
  }
  return data;
}

function withIndexes(events: GuardEvent[]): GuardEvent[] {
  return events.map((event, index) => ({ ...event, index: event.index ?? index }));
}

function optionalString(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

function optionalStringOrNumber(raw: unknown): string | number | undefined {
  return typeof raw === "string" || typeof raw === "number" ? raw : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, fieldValue, hashJson, isJsonObject, mergeJsonObject, parseJson, valuesEqual } from "./json.js";
import type {
  AppendEventResult,
  JsonObject,
  JsonPrimitive,
  LedgerEvent,
  LedgerEventInput,
  LedgerOptions,
  MaterializedEntity,
  MaterializedLedger,
  QueryOptions,
  VerifyIssue,
  VerifyResult,
} from "./types.js";

export const DEFAULT_LEDGER_DIR = ".iso-ledger";
export const DEFAULT_EVENTS_FILE = "events.jsonl";

export function resolveLedgerPath(options: LedgerOptions = {}): string {
  if (options.path) return resolve(options.path);
  return resolve(options.dir ?? process.cwd(), DEFAULT_LEDGER_DIR, DEFAULT_EVENTS_FILE);
}

export function initLedger(options: LedgerOptions = {}): string {
  const path = resolveLedgerPath(options);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "");
  return path;
}

export function appendEvent(options: LedgerOptions, input: LedgerEventInput): AppendEventResult {
  const path = initLedger(options);
  const existing = readLedger({ path });
  const event = normalizeEventInput(input);

  const duplicate = existing.find((candidate) =>
    candidate.id === event.id ||
    (event.idempotencyKey !== undefined && candidate.idempotencyKey === event.idempotencyKey),
  );
  if (duplicate) {
    return { event: duplicate, appended: false, duplicateOf: duplicate.id };
  }

  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return { event, appended: true };
}

export function readLedger(options: LedgerOptions = {}): LedgerEvent[] {
  const path = resolveLedgerPath(options);
  if (!existsSync(path)) return [];
  return parseLedgerText(readFileSync(path, "utf8"), path);
}

export function parseLedgerText(raw: string, sourcePath = "<inline>"): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parsed = parseJson(line, `${sourcePath}:${i + 1}`);
    const event = coerceLedgerEvent(parsed, i + 1);
    if (!event) throw new Error(`${sourcePath}:${i + 1}: expected a ledger event object`);
    events.push(event);
  }
  return events;
}

export function queryEvents(events: LedgerEvent[], options: QueryOptions = {}): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const event of events) {
    if (options.type !== undefined && event.type !== options.type) continue;
    if (options.key !== undefined && event.key !== options.key) continue;
    if (options.subject !== undefined && event.subject !== options.subject) continue;
    if (options.where && !matchesWhere(event, options.where)) continue;
    out.push(event);
    if (options.limit !== undefined && out.length >= options.limit) break;
  }
  return out;
}

export function hasEvent(events: LedgerEvent[], options: QueryOptions = {}): boolean {
  return queryEvents(events, { ...options, limit: 1 }).length > 0;
}

export function verifyLedger(options: LedgerOptions = {}): VerifyResult {
  const path = resolveLedgerPath(options);
  if (!existsSync(path)) {
    return resultFromIssues(0, [
      { severity: "error", code: "missing-ledger", message: `ledger file does not exist: ${path}` },
    ]);
  }
  return verifyLedgerText(readFileSync(path, "utf8"), path);
}

export function verifyLedgerText(raw: string, sourcePath = "<inline>"): VerifyResult {
  const issues: VerifyIssue[] = [];
  const ids = new Map<string, number>();
  const idempotencyKeys = new Map<string, number>();
  let eventCount = 0;

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]?.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ severity: "error", code: "invalid-json", line: lineNo, message });
      continue;
    }

    const eventIssues = validateEventLike(parsed, lineNo);
    issues.push(...eventIssues);
    const event = eventIssues.some((issue) => issue.severity === "error")
      ? null
      : coerceLedgerEvent(parsed, lineNo);
    if (!event) continue;
    eventCount += 1;

    const previousIdLine = ids.get(event.id);
    if (previousIdLine !== undefined) {
      issues.push({
        severity: "error",
        code: "duplicate-id",
        line: lineNo,
        eventId: event.id,
        message: `duplicate event id "${event.id}" also appeared on line ${previousIdLine}`,
      });
    } else {
      ids.set(event.id, lineNo);
    }

    if (event.idempotencyKey) {
      const previousKeyLine = idempotencyKeys.get(event.idempotencyKey);
      if (previousKeyLine !== undefined) {
        issues.push({
          severity: "error",
          code: "duplicate-idempotency-key",
          line: lineNo,
          eventId: event.id,
          message: `duplicate idempotency key "${event.idempotencyKey}" also appeared on line ${previousKeyLine}`,
        });
      } else {
        idempotencyKeys.set(event.idempotencyKey, lineNo);
      }
    }
  }

  return resultFromIssues(eventCount, issues);
}

export function materializeLedger(events: LedgerEvent[], generatedAt = new Date().toISOString()): MaterializedLedger {
  const entities: Record<string, MaterializedEntity> = {};
  for (const event of events) {
    if (!event.subject) continue;
    const existing = entities[event.subject];
    const deleted = isDeleteEvent(event.type);
    const entity: MaterializedEntity = existing ?? {
      subject: event.subject,
      createdAt: event.at,
      updatedAt: event.at,
      deleted: false,
      eventCount: 0,
      eventIds: [],
      lastEventType: event.type,
      data: {},
    };
    entity.updatedAt = event.at;
    entity.deleted = deleted ? true : entity.deleted;
    entity.eventCount += 1;
    entity.eventIds.push(event.id);
    entity.lastEventType = event.type;
    entity.data = mergeJsonObject(entity.data, event.data);
    entities[event.subject] = entity;
  }
  return {
    generatedAt,
    eventCount: events.length,
    entityCount: Object.keys(entities).length,
    entities,
  };
}

export function normalizeEventInput(input: LedgerEventInput): LedgerEvent {
  if (!input || typeof input !== "object") throw new Error("event input must be an object");
  const type = requireNonEmptyString(input.type, "type");
  const at = input.at ?? new Date().toISOString();
  if (!isValidIsoDate(at)) throw new Error("at must be an ISO date string");
  const data = input.data ?? {};
  const meta = input.meta ?? {};
  if (!isJsonObject(data)) throw new Error("data must be a JSON object");
  if (!isJsonObject(meta)) throw new Error("meta must be a JSON object");

  const eventWithoutId: Omit<LedgerEvent, "id"> = {
    type,
    at,
    data,
    meta,
  };
  if (input.key !== undefined) eventWithoutId.key = requireNonEmptyString(input.key, "key");
  if (input.subject !== undefined) eventWithoutId.subject = requireNonEmptyString(input.subject, "subject");
  if (input.idempotencyKey !== undefined) {
    eventWithoutId.idempotencyKey = requireNonEmptyString(input.idempotencyKey, "idempotencyKey");
  }

  const id = input.id
    ? requireNonEmptyString(input.id, "id")
    : defaultEventId(eventWithoutId);
  return { id, ...eventWithoutId };
}

function defaultEventId(event: Omit<LedgerEvent, "id">): string {
  if (event.idempotencyKey) {
    return `evt_${hashJson({ idempotencyKey: event.idempotencyKey }).slice(0, 20)}`;
  }
  return `evt_${hashJson(event as unknown as JsonObject).slice(0, 20)}`;
}

function coerceLedgerEvent(raw: unknown, line: number): LedgerEvent | null {
  const issues = validateEventLike(raw, line);
  if (issues.some((issue) => issue.severity === "error")) return null;
  const record = raw as Record<string, unknown>;
  return {
    id: record.id as string,
    type: record.type as string,
    at: record.at as string,
    key: record.key as string | undefined,
    subject: record.subject as string | undefined,
    idempotencyKey: record.idempotencyKey as string | undefined,
    data: (record.data ?? {}) as JsonObject,
    meta: (record.meta ?? {}) as JsonObject,
  };
}

function validateEventLike(raw: unknown, line: number): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  if (!isJsonObject(raw)) {
    return [{ severity: "error", code: "invalid-event", line, message: "ledger event must be a JSON object" }];
  }
  requireStringIssue(raw.id, "id", line, issues);
  requireStringIssue(raw.type, "type", line, issues);
  requireStringIssue(raw.at, "at", line, issues);
  if (typeof raw.at === "string" && !isValidIsoDate(raw.at)) {
    issues.push({ severity: "error", code: "invalid-at", line, eventId: optionalId(raw), message: "at must be an ISO date string" });
  }
  optionalStringIssue(raw.key, "key", line, issues, raw);
  optionalStringIssue(raw.subject, "subject", line, issues, raw);
  optionalStringIssue(raw.idempotencyKey, "idempotencyKey", line, issues, raw);
  if (raw.data !== undefined && !isJsonObject(raw.data)) {
    issues.push({ severity: "error", code: "invalid-data", line, eventId: optionalId(raw), message: "data must be a JSON object" });
  }
  if (raw.meta !== undefined && !isJsonObject(raw.meta)) {
    issues.push({ severity: "error", code: "invalid-meta", line, eventId: optionalId(raw), message: "meta must be a JSON object" });
  }
  return issues;
}

function matchesWhere(event: LedgerEvent, where: Record<string, JsonPrimitive>): boolean {
  const source = event as unknown as JsonObject;
  for (const [path, expected] of Object.entries(where)) {
    const topLevel = fieldValue(source, path);
    const actual = topLevel === undefined ? fieldValue(event.data, path) : topLevel;
    if (!valuesEqual(actual, expected)) return false;
  }
  return true;
}

function isDeleteEvent(type: string): boolean {
  return type === "deleted" || type.endsWith(".deleted") || type.endsWith(".removed");
}

function resultFromIssues(eventCount: number, issues: VerifyIssue[]): VerifyResult {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return { ok: errors === 0, eventCount, errors, warnings, issues };
}

function requireStringIssue(value: unknown, field: string, line: number, issues: VerifyIssue[]): void {
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ severity: "error", code: `missing-${field}`, line, message: `${field} must be a non-empty string` });
  }
}

function optionalStringIssue(
  value: unknown,
  field: string,
  line: number,
  issues: VerifyIssue[],
  raw: Record<string, unknown>,
): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    issues.push({ severity: "error", code: `invalid-${field}`, line, eventId: optionalId(raw), message: `${field} must be a non-empty string when present` });
  }
}

function optionalId(raw: Record<string, unknown>): string | undefined {
  return typeof raw.id === "string" ? raw.id : undefined;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function isValidIsoDate(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

export function eventToLine(event: LedgerEvent): string {
  return canonicalJson(event as unknown as JsonObject);
}

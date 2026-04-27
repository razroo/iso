import { createHash } from "node:crypto";
import { isJsonObject, stableStringify, toJsonValue } from "./json.js";
import type {
  DurationInput,
  DurationObject,
  JsonPrimitive,
  TimelineCheckOptions,
  TimelineCheckResult,
  TimelineConfig,
  TimelineEvent,
  TimelineIssue,
  TimelineItem,
  TimelineItemState,
  TimelineMatcher,
  TimelinePlanOptions,
  TimelineResult,
  TimelineRule,
  TimelineStats,
  TimelineVerifyResult,
} from "./types.js";

const DEFAULT_FAIL_ON: TimelineItemState[] = ["overdue"];
const STATE_ORDER: Record<TimelineItemState, number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  blocked: 3,
  suppressed: 4,
};

export function loadTimelineConfig(input: unknown): TimelineConfig {
  const config = requireObject(input, "config") as unknown as TimelineConfig;
  if (config.version !== 1) throw new Error("config.version must be 1");
  if (config.defaults !== undefined) {
    requireObject(config.defaults, "config.defaults");
    if (config.defaults.now !== undefined) parseDate(config.defaults.now, "config.defaults.now");
    if (config.defaults.latestOnly !== undefined && typeof config.defaults.latestOnly !== "boolean") {
      throw new Error("config.defaults.latestOnly must be boolean");
    }
    if (config.defaults.overdueAfter !== undefined) parseDuration(config.defaults.overdueAfter, "config.defaults.overdueAfter");
  }
  if (!Array.isArray(config.rules) || config.rules.length === 0) {
    throw new Error("config.rules must be a non-empty array");
  }
  const ids = new Set<string>();
  for (let index = 0; index < config.rules.length; index++) {
    const rule = requireObject(config.rules[index], `config.rules[${index}]`) as unknown as TimelineRule;
    if (!isNonEmptyString(rule.id)) throw new Error(`config.rules[${index}].id must be a non-empty string`);
    if (ids.has(rule.id)) throw new Error(`duplicate rule id "${rule.id}"`);
    ids.add(rule.id);
    if (!isNonEmptyString(rule.action)) throw new Error(`rule "${rule.id}" action must be a non-empty string`);
    if (rule.match !== undefined) validateMatcher(rule.match, `rule "${rule.id}".match`);
    if (rule.after !== undefined) parseDuration(rule.after, `rule "${rule.id}".after`);
    if (rule.overdueAfter !== undefined) parseDuration(rule.overdueAfter, `rule "${rule.id}".overdueAfter`);
    if (rule.latestOnly !== undefined && typeof rule.latestOnly !== "boolean") {
      throw new Error(`rule "${rule.id}" latestOnly must be boolean`);
    }
    for (const [field, matchers] of Object.entries({
      suppressWhen: rule.suppressWhen,
      blockWhen: rule.blockWhen,
    })) {
      if (matchers === undefined) continue;
      if (!Array.isArray(matchers)) throw new Error(`rule "${rule.id}" ${field} must be an array`);
      for (let m = 0; m < matchers.length; m++) validateMatcher(matchers[m], `rule "${rule.id}".${field}[${m}]`);
    }
    if (rule.meta !== undefined && !isJsonObject(rule.meta)) throw new Error(`rule "${rule.id}" meta must be an object`);
  }
  return config;
}

export function loadTimelineEvents(input: unknown): TimelineEvent[] {
  const raw = Array.isArray(input)
    ? input
    : isJsonObject(input) && Array.isArray(input.events)
      ? input.events
      : undefined;
  if (!raw) throw new Error("events must be an array or an object with an events array");

  const events = raw.map((value, index) => loadTimelineEvent(value, `events[${index}]`));
  events.sort(compareEvents);
  return events;
}

export function planTimeline(configInput: TimelineConfig | unknown, eventInput: TimelineEvent[] | unknown, options: TimelinePlanOptions = {}): TimelineResult {
  const config = loadTimelineConfig(configInput);
  const events = loadTimelineEvents(eventInput);
  const now = normalizeNow(options.now ?? config.defaults?.now);
  const items: TimelineItem[] = [];

  for (const rule of config.rules) {
    const matches = events.filter((event) => eventMatches(event, rule.match));
    const basis = latestOnly(rule, config) ? latestByKey(matches) : matches;
    for (const event of basis) {
      items.push(buildItem(config, rule, event, events, now));
    }
  }

  items.sort(compareItems);
  const result = {
    schemaVersion: 1 as const,
    id: "",
    generatedAt: now.toISOString(),
    now: now.toISOString(),
    configHash: hashJson(toJsonValue(config)),
    items,
    stats: statsFor(items),
    issues: [] as TimelineIssue[],
  };
  result.id = timelineResultId(result);
  return result;
}

export function filterTimelineResult(result: TimelineResult, states: TimelineItemState[]): TimelineResult {
  const allowed = new Set(states);
  const items = result.items.filter((item) => allowed.has(item.state));
  const updated = {
    ...result,
    id: "",
    items,
    stats: statsFor(items),
  };
  updated.id = timelineResultId(updated);
  return updated;
}

export function checkTimeline(config: TimelineConfig | unknown, events: TimelineEvent[] | unknown, options: TimelineCheckOptions = {}): TimelineCheckResult {
  const result = planTimeline(config, events, options);
  const failOn = normalizeFailOn(options.failOn);
  const failStates = new Set(failOn);
  const issues = [
    ...result.issues,
    ...result.items
      .filter((item) => failStates.has(item.state))
      .map((item) => error(
        "timeline-action-required",
        `${item.action} for ${item.key} is ${item.state} (due ${item.dueAt})`,
        item.rule,
        item.id,
      )),
  ];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  const resultWithIssues = { ...result, id: "", issues };
  resultWithIssues.id = timelineResultId(resultWithIssues);
  return {
    ok: errors === 0,
    errors,
    warnings,
    failOn,
    result: resultWithIssues,
    issues,
  };
}

export function verifyTimelineResult(value: unknown): TimelineVerifyResult {
  const issues: TimelineIssue[] = [];
  if (!isJsonObject(value)) return issueResult(error("invalid-result", "timeline result must be a JSON object"));
  const result = value as unknown as TimelineResult;
  if (result.schemaVersion !== 1) issues.push(error("invalid-schema", "schemaVersion must be 1"));
  if (!isNonEmptyString(result.id)) issues.push(error("invalid-id", "id must be a non-empty string"));
  if (!isNonEmptyString(result.generatedAt)) issues.push(error("invalid-generated-at", "generatedAt must be a non-empty string"));
  else parseDateSafe(result.generatedAt, "generatedAt", issues);
  if (!isNonEmptyString(result.now)) issues.push(error("invalid-now", "now must be a non-empty string"));
  else parseDateSafe(result.now, "now", issues);
  if (!isNonEmptyString(result.configHash)) issues.push(error("invalid-config-hash", "configHash must be a non-empty string"));
  if (!Array.isArray(result.items)) issues.push(error("invalid-items", "items must be an array"));
  if (!isJsonObject(result.stats)) issues.push(error("invalid-stats", "stats must be an object"));
  if (!Array.isArray(result.issues)) issues.push(error("invalid-issues", "issues must be an array"));

  if (Array.isArray(result.items)) {
    for (const [index, item] of result.items.entries()) validateResultItem(item, index, issues);
    if (isJsonObject(result.stats)) {
      const expected = statsFor(result.items);
      for (const key of Object.keys(expected) as Array<keyof TimelineStats>) {
        if (result.stats[key] !== expected[key]) issues.push(error("stats-mismatch", `stats.${key} must be ${expected[key]}`));
      }
    }
  }
  if (Array.isArray(result.issues)) {
    for (const [index, issue] of result.issues.entries()) {
      if (issue.severity !== "error" && issue.severity !== "warn") {
        issues.push(error("invalid-issue-severity", `issues[${index}].severity must be error or warn`));
      }
      if (!isNonEmptyString(issue.code)) issues.push(error("invalid-issue-code", `issues[${index}].code must be a non-empty string`));
    }
  }
  if (isNonEmptyString(result.id)) {
    const expected = timelineResultId(result);
    if (result.id !== expected) issues.push(error("id-mismatch", `id does not match content hash; expected ${expected}`));
  }
  return issueResult(...issues);
}

export function timelineResultId(result: TimelineResult | Omit<TimelineResult, "id">): string {
  const payload = { ...(result as TimelineResult) };
  delete (payload as Partial<TimelineResult>).id;
  return `timeline:${hashJson(toJsonValue(payload)).slice(0, 16)}`;
}

function buildItem(config: TimelineConfig, rule: TimelineRule, event: TimelineEvent, events: TimelineEvent[], now: Date): TimelineItem {
  const dueAtDate = addDuration(parseDate(event.at, `event ${event.id || event.key}.at`), parseDuration(rule.after ?? "0s", `rule "${rule.id}".after`));
  const overdueAfter = rule.overdueAfter ?? config.defaults?.overdueAfter;
  const overdueAtDate = overdueAfter === undefined ? undefined : addDuration(dueAtDate, parseDuration(overdueAfter, `rule "${rule.id}".overdueAfter`));
  const suppressedBy = relatedMatches(events, event, rule.suppressWhen || []);
  const blockedBy = relatedMatches(events, event, rule.blockWhen || []);
  const state = itemState(now, dueAtDate, overdueAtDate, suppressedBy, blockedBy);
  const itemWithoutId = stripUndefined({
    rule: rule.id,
    label: rule.label || rule.id,
    action: rule.action,
    key: event.key,
    state,
    event,
    dueAt: dueAtDate.toISOString(),
    overdueAt: overdueAtDate?.toISOString(),
    reasons: reasonsFor(state, event, dueAtDate, overdueAtDate, suppressedBy, blockedBy),
    suppressedBy: suppressedBy.length ? suppressedBy : undefined,
    blockedBy: blockedBy.length ? blockedBy : undefined,
    meta: rule.meta,
  }) as Omit<TimelineItem, "id">;
  return { ...itemWithoutId, id: timelineItemId(itemWithoutId) };
}

function itemState(now: Date, dueAt: Date, overdueAt: Date | undefined, suppressedBy: TimelineEvent[], blockedBy: TimelineEvent[]): TimelineItemState {
  if (blockedBy.length > 0) return "blocked";
  if (suppressedBy.length > 0) return "suppressed";
  if (now.getTime() < dueAt.getTime()) return "upcoming";
  if (overdueAt && now.getTime() >= overdueAt.getTime()) return "overdue";
  return "due";
}

function relatedMatches(events: TimelineEvent[], basis: TimelineEvent, matchers: TimelineMatcher[]): TimelineEvent[] {
  if (matchers.length === 0) return [];
  const basisAt = parseDate(basis.at, `event ${basis.id || basis.key}.at`).getTime();
  return events.filter((event) => {
    if (event.key !== basis.key) return false;
    if (parseDate(event.at, `event ${event.id || event.key}.at`).getTime() < basisAt) return false;
    return matchers.some((matcher) => eventMatches(event, matcher));
  });
}

function reasonsFor(
  state: TimelineItemState,
  event: TimelineEvent,
  dueAt: Date,
  overdueAt: Date | undefined,
  suppressedBy: TimelineEvent[],
  blockedBy: TimelineEvent[],
): string[] {
  const reasons = [`matched ${event.type} at ${event.at}`, `due at ${dueAt.toISOString()}`];
  if (overdueAt) reasons.push(`overdue at ${overdueAt.toISOString()}`);
  if (state === "suppressed") reasons.push(`suppressed by ${suppressedBy.map(eventLabel).join(", ")}`);
  if (state === "blocked") reasons.push(`blocked by ${blockedBy.map(eventLabel).join(", ")}`);
  return reasons;
}

function eventMatches(event: TimelineEvent, matcher: TimelineMatcher | undefined): boolean {
  if (!matcher) return true;
  if (matcher.type !== undefined && !matchesOne(event.type, matcher.type)) return false;
  if (matcher.key !== undefined && !matchesOne(event.key, matcher.key)) return false;
  if (matcher.where !== undefined) {
    for (const [path, expected] of Object.entries(matcher.where)) {
      const actual = valueAt(event, path);
      if (!matchesPrimitive(actual, expected)) return false;
    }
  }
  return true;
}

function latestByKey(events: TimelineEvent[]): TimelineEvent[] {
  const byKey = new Map<string, TimelineEvent>();
  for (const event of events) {
    const current = byKey.get(event.key);
    if (!current || compareEvents(event, current) > 0) byKey.set(event.key, event);
  }
  return [...byKey.values()].sort(compareEvents);
}

function latestOnly(rule: TimelineRule, config: TimelineConfig): boolean {
  return rule.latestOnly ?? config.defaults?.latestOnly ?? true;
}

function loadTimelineEvent(input: unknown, path: string): TimelineEvent {
  const event = requireObject(input, path) as unknown as TimelineEvent;
  if (event.id !== undefined && !isNonEmptyString(event.id)) throw new Error(`${path}.id must be a non-empty string`);
  if (!isNonEmptyString(event.key)) throw new Error(`${path}.key must be a non-empty string`);
  if (!isNonEmptyString(event.type)) throw new Error(`${path}.type must be a non-empty string`);
  if (!isNonEmptyString(event.at)) throw new Error(`${path}.at must be a non-empty string`);
  parseDate(event.at, `${path}.at`);
  if (event.data !== undefined && !isJsonObject(event.data)) throw new Error(`${path}.data must be an object`);
  if (event.source !== undefined) {
    requireObject(event.source, `${path}.source`);
    if (event.source.path !== undefined && typeof event.source.path !== "string") throw new Error(`${path}.source.path must be a string`);
    if (event.source.line !== undefined && (!Number.isInteger(event.source.line) || event.source.line <= 0)) {
      throw new Error(`${path}.source.line must be a positive integer`);
    }
  }
  return event;
}

function validateMatcher(input: unknown, path: string): void {
  const matcher = requireObject(input, path) as unknown as TimelineMatcher;
  if (matcher.type !== undefined) validateStringOrStringArray(matcher.type, `${path}.type`);
  if (matcher.key !== undefined) validateStringOrStringArray(matcher.key, `${path}.key`);
  if (matcher.where !== undefined) {
    requireObject(matcher.where, `${path}.where`);
    for (const [field, expected] of Object.entries(matcher.where)) {
      if (!isNonEmptyString(field)) throw new Error(`${path}.where has an empty field path`);
      if (Array.isArray(expected)) {
        if (expected.length === 0) throw new Error(`${path}.where.${field} must not be an empty array`);
        for (const item of expected) validatePrimitive(item, `${path}.where.${field}`);
      } else {
        validatePrimitive(expected, `${path}.where.${field}`);
      }
    }
  }
}

function validateStringOrStringArray(value: string | string[], path: string): void {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`${path} must not be an empty array`);
    for (const item of value) if (!isNonEmptyString(item)) throw new Error(`${path} entries must be non-empty strings`);
  } else if (!isNonEmptyString(value)) {
    throw new Error(`${path} must be a non-empty string or string array`);
  }
}

function validatePrimitive(value: unknown, path: string): void {
  if (value === null) return;
  if (["string", "number", "boolean"].includes(typeof value)) return;
  throw new Error(`${path} must be a JSON primitive or array of JSON primitives`);
}

function valueAt(event: TimelineEvent, path: string): JsonPrimitive | undefined {
  const parts = path.split(".");
  let value: unknown = event;
  for (const part of parts) {
    if (!isJsonObject(value) && !(value && typeof value === "object")) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value as JsonPrimitive;
  return undefined;
}

function matchesOne(value: string, expected: string | string[]): boolean {
  return Array.isArray(expected) ? expected.includes(value) : value === expected;
}

function matchesPrimitive(actual: JsonPrimitive | undefined, expected: JsonPrimitive | JsonPrimitive[]): boolean {
  if (Array.isArray(expected)) return expected.some((item) => Object.is(actual, item));
  return Object.is(actual, expected);
}

function parseDuration(input: DurationInput, path: string): number {
  if (typeof input === "string") return parseDurationString(input, path);
  if (isJsonObject(input)) return parseDurationObject(input as unknown as DurationObject, path);
  throw new Error(`${path} must be a duration string or object`);
}

function parseDurationString(input: string, path: string): number {
  const text = input.trim();
  if (!text) throw new Error(`${path} must not be empty`);
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/i.exec(text);
  if (!match) throw new Error(`${path} must look like 30m, 12h, 7d, or 2w`);
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${path} must be a non-negative duration`);
  const unit = match[2]?.toLowerCase();
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 604_800_000;
  return value * factor;
}

function parseDurationObject(input: DurationObject, path: string): number {
  const multipliers: Record<keyof DurationObject, number> = {
    weeks: 604_800_000,
    days: 86_400_000,
    hours: 3_600_000,
    minutes: 60_000,
    seconds: 1000,
  };
  let total = 0;
  let seen = false;
  for (const [key, factor] of Object.entries(multipliers) as Array<[keyof DurationObject, number]>) {
    const value = input[key];
    if (value === undefined) continue;
    seen = true;
    if (!Number.isFinite(value) || value < 0) throw new Error(`${path}.${key} must be a non-negative number`);
    total += value * factor;
  }
  if (!seen) throw new Error(`${path} duration object must include at least one field`);
  return total;
}

function addDuration(date: Date, durationMs: number): Date {
  return new Date(date.getTime() + durationMs);
}

function normalizeNow(input: string | Date | undefined): Date {
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) throw new Error("now must be a valid Date");
    return input;
  }
  return input ? parseDate(input, "now") : new Date();
}

function parseDate(input: string, path: string): Date {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) throw new Error(`${path} must be a valid ISO date/time`);
  return date;
}

function parseDateSafe(input: string, path: string, issues: TimelineIssue[]): void {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) issues.push(error("invalid-date", `${path} must be a valid ISO date/time`));
}

function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  return parseDate(a.at, `event ${a.id || a.key}.at`).getTime() - parseDate(b.at, `event ${b.id || b.key}.at`).getTime()
    || a.key.localeCompare(b.key)
    || a.type.localeCompare(b.type)
    || (a.id || "").localeCompare(b.id || "");
}

function compareItems(a: TimelineItem, b: TimelineItem): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || a.dueAt.localeCompare(b.dueAt)
    || a.key.localeCompare(b.key)
    || a.rule.localeCompare(b.rule)
    || a.id.localeCompare(b.id);
}

function statsFor(items: TimelineItem[]): TimelineStats {
  const stats: TimelineStats = { total: items.length, upcoming: 0, due: 0, overdue: 0, suppressed: 0, blocked: 0 };
  for (const item of items) stats[item.state] += 1;
  return stats;
}

function validateResultItem(item: unknown, index: number, issues: TimelineIssue[]): void {
  if (!isJsonObject(item)) {
    issues.push(error("invalid-item", `items[${index}] must be an object`));
    return;
  }
  const value = item as unknown as TimelineItem;
  if (!isNonEmptyString(value.id)) issues.push(error("invalid-item-id", `items[${index}].id must be a non-empty string`));
  if (!isNonEmptyString(value.rule)) issues.push(error("invalid-item-rule", `items[${index}].rule must be a non-empty string`));
  if (!isNonEmptyString(value.action)) issues.push(error("invalid-item-action", `items[${index}].action must be a non-empty string`));
  if (!isTimelineState(value.state)) issues.push(error("invalid-item-state", `items[${index}].state is invalid`));
  if (!isNonEmptyString(value.dueAt)) issues.push(error("invalid-item-due-at", `items[${index}].dueAt must be a non-empty string`));
  else parseDateSafe(value.dueAt, `items[${index}].dueAt`, issues);
  if (!isJsonObject(value.event)) issues.push(error("invalid-item-event", `items[${index}].event must be an object`));
  if (!Array.isArray(value.reasons)) issues.push(error("invalid-item-reasons", `items[${index}].reasons must be an array`));
}

function timelineItemId(item: Omit<TimelineItem, "id">): string {
  return `item:${hashJson(toJsonValue(item)).slice(0, 16)}`;
}

function hashJson(value: ReturnType<typeof toJsonValue>): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeFailOn(input: TimelineCheckOptions["failOn"]): TimelineItemState[] {
  if (input === "none") return [];
  const values = input === undefined ? DEFAULT_FAIL_ON : Array.isArray(input) ? input : [input];
  const out = new Set<TimelineItemState>();
  for (const value of values) {
    if (!isTimelineState(value)) throw new Error(`unknown failOn state "${value}"`);
    out.add(value);
    if (value === "due") out.add("overdue");
  }
  return [...out];
}

function isTimelineState(value: unknown): value is TimelineItemState {
  return value === "upcoming" || value === "due" || value === "overdue" || value === "suppressed" || value === "blocked";
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isJsonObject(value)) throw new Error(`${path} must be a JSON object`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function eventLabel(event: TimelineEvent): string {
  return event.id || `${event.type}@${event.at}`;
}

function error(code: string, message: string, rule?: string, item?: string): TimelineIssue {
  return stripUndefined({ severity: "error" as const, code, message, rule, item });
}

function issueResult(...issues: TimelineIssue[]): TimelineVerifyResult {
  return {
    ok: issues.filter((issue) => issue.severity === "error").length === 0,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warn").length,
    issues,
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

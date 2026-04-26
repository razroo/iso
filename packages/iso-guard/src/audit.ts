import type {
  AuditResult,
  EventSelector,
  ForbidTextRule,
  GuardEvent,
  GuardPolicy,
  GuardRule,
  RegexSpec,
  Severity,
  Violation,
} from "./types.js";

export function audit(policy: GuardPolicy, events: GuardEvent[]): AuditResult {
  const normalized = events.map((event, index) => ({ ...event, index: event.index ?? index }));
  const violations: Violation[] = [];
  for (const rule of policy.rules) {
    violations.push(...auditRule(rule, normalized));
  }
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warn").length;
  return {
    ok: errors === 0,
    ruleCount: policy.rules.length,
    eventCount: normalized.length,
    errors,
    warnings,
    violations,
  };
}

export function selectorMatches(event: GuardEvent, selector: EventSelector): boolean {
  if (selector.type !== undefined && !oneOf(event.type, selector.type)) return false;
  if (selector.name !== undefined && !oneOf(event.name, selector.name)) return false;
  if (selector.text !== undefined) {
    const haystack = eventHaystack(event);
    if (!new RegExp(selector.text).test(haystack)) return false;
  }
  if (selector.fields) {
    for (const [field, expected] of Object.entries(selector.fields)) {
      const actual = fieldValue(event, field);
      if (Array.isArray(expected)) {
        if (!expected.some((value) => valuesEqual(actual, value))) return false;
      } else if (!valuesEqual(actual, expected)) {
        return false;
      }
    }
  }
  return true;
}

export function fieldValue(event: GuardEvent, field: string): unknown {
  const topLevel = getPath(event as unknown as Record<string, unknown>, field);
  if (topLevel !== undefined) return topLevel;
  if (!event.data) return undefined;
  return getPath(event.data, field);
}

function auditRule(rule: GuardRule, events: GuardEvent[]): Violation[] {
  switch (rule.type) {
    case "max-per-group":
      return auditMaxPerGroup(rule, events);
    case "require-before":
      return auditRequireBefore(rule, events);
    case "require-after":
      return auditRequireAfter(rule, events);
    case "forbid-text":
      return auditForbidText(rule, events);
    case "no-overlap":
      return auditNoOverlap(rule, events);
  }
}

function auditMaxPerGroup(rule: Extract<GuardRule, { type: "max-per-group" }>, events: GuardEvent[]): Violation[] {
  const groups = new Map<string, GuardEvent[]>();
  for (const event of events) {
    if (!selectorMatches(event, rule.match)) continue;
    const group = groupValue(event, rule.groupBy);
    const bucket = groups.get(group) ?? [];
    bucket.push(event);
    groups.set(group, bucket);
  }

  const violations: Violation[] = [];
  for (const [group, bucket] of groups) {
    if (bucket.length <= rule.max) continue;
    violations.push({
      ruleId: rule.id,
      severity: severity(rule),
      message: `group "${group}" matched ${bucket.length} event(s), max is ${rule.max}`,
      eventIndexes: bucket.map((event) => event.index ?? 0),
      details: { group, max: rule.max, count: bucket.length },
    });
  }
  return violations;
}

function auditRequireBefore(rule: Extract<GuardRule, { type: "require-before" }>, events: GuardEvent[]): Violation[] {
  const violations: Violation[] = [];
  for (let i = 0; i < events.length; i++) {
    const trigger = events[i];
    if (!trigger || !selectorMatches(trigger, rule.trigger)) continue;
    const triggerGroup = groupValue(trigger, rule.groupBy);
    const found = events
      .slice(0, i)
      .some((candidate) =>
        selectorMatches(candidate, rule.require) &&
        (!rule.groupBy || groupValue(candidate, rule.groupBy) === triggerGroup),
      );
    if (!found) {
      violations.push({
        ruleId: rule.id,
        severity: severity(rule),
        message: `event #${trigger.index ?? i} matched trigger but no required event appeared before it`,
        eventIndex: trigger.index ?? i,
        details: rule.groupBy ? { groupBy: rule.groupBy, group: triggerGroup } : undefined,
      });
    }
  }
  return violations;
}

function auditRequireAfter(rule: Extract<GuardRule, { type: "require-after" }>, events: GuardEvent[]): Violation[] {
  const triggerIndexes = events
    .map((event, index) => selectorMatches(event, rule.ifAny) ? index : -1)
    .filter((index) => index >= 0);
  if (triggerIndexes.length === 0) return [];

  const lastTriggerIndex = Math.max(...triggerIndexes);
  const tail = events.slice(lastTriggerIndex + 1);
  const violations: Violation[] = [];
  for (const required of rule.require) {
    if (tail.some((event) => selectorMatches(event, required))) continue;
    violations.push({
      ruleId: rule.id,
      severity: severity(rule),
      message: `required follow-up event did not appear after trigger event #${events[lastTriggerIndex]?.index ?? lastTriggerIndex}`,
      eventIndex: events[lastTriggerIndex]?.index ?? lastTriggerIndex,
      details: { required },
    });
  }
  return violations;
}

function auditForbidText(rule: ForbidTextRule, events: GuardEvent[]): Violation[] {
  const patterns = rule.patterns.map((pattern) => compileRegex(pattern, rule.id));
  const violations: Violation[] = [];
  for (const event of events) {
    if (rule.match && !selectorMatches(event, rule.match)) continue;
    const haystack = eventHaystack(event);
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (!pattern.test(haystack)) continue;
      violations.push({
        ruleId: rule.id,
        severity: severity(rule),
        message: `event #${event.index ?? 0} matched forbidden pattern ${pattern}`,
        eventIndex: event.index,
        details: { pattern: String(pattern) },
      });
    }
  }
  return violations;
}

function auditNoOverlap(rule: Extract<GuardRule, { type: "no-overlap" }>, events: GuardEvent[]): Violation[] {
  const active = new Map<string, GuardEvent>();
  const violations: Violation[] = [];

  for (const event of events) {
    if (selectorMatches(event, rule.end)) {
      const key = String(fieldValue(event, rule.keyBy) ?? "");
      if (key) active.delete(key);
    }

    if (!selectorMatches(event, rule.start)) continue;
    const key = String(fieldValue(event, rule.keyBy) ?? "");
    if (!key) {
      violations.push({
        ruleId: rule.id,
        severity: severity(rule),
        message: `event #${event.index ?? 0} matched start but keyBy "${rule.keyBy}" was missing`,
        eventIndex: event.index,
        details: { keyBy: rule.keyBy },
      });
      continue;
    }
    const previous = active.get(key);
    if (previous) {
      violations.push({
        ruleId: rule.id,
        severity: severity(rule),
        message: `event #${event.index ?? 0} started key "${key}" while event #${previous.index ?? 0} was still active`,
        eventIndexes: [previous.index ?? 0, event.index ?? 0],
        details: { key },
      });
    }
    active.set(key, event);
  }

  if (rule.requireClosed) {
    for (const [key, event] of active) {
      violations.push({
        ruleId: rule.id,
        severity: severity(rule),
        message: `key "${key}" was still active at end of event stream`,
        eventIndex: event.index,
        details: { key },
      });
    }
  }

  return violations;
}

function severity(rule: { severity?: Severity }): Severity {
  return rule.severity ?? "error";
}

function groupValue(event: GuardEvent, groupBy: string | undefined): string {
  if (!groupBy) return "all";
  const value = fieldValue(event, groupBy);
  return value === undefined || value === null || value === "" ? "missing" : String(value);
}

function oneOf(actual: string | undefined, expected: string | string[]): boolean {
  if (actual === undefined) return false;
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

function valuesEqual(actual: unknown, expected: string | number | boolean): boolean {
  if (typeof actual === typeof expected) return actual === expected;
  return String(actual) === String(expected);
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function eventHaystack(event: GuardEvent): string {
  return [
    event.type,
    event.name,
    event.text,
    safeJson(event.data),
  ].filter(Boolean).join("\n");
}

function compileRegex(pattern: RegexSpec, ruleId: string): RegExp {
  try {
    if (typeof pattern === "string") return new RegExp(pattern);
    return new RegExp(pattern.source, pattern.flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${ruleId}: invalid regex: ${message}`);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

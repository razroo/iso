import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type {
  EventSelector,
  ForbidTextRule,
  GuardPolicy,
  GuardRule,
  MaxPerGroupRule,
  NoOverlapRule,
  RegexSpec,
  RequireAfterRule,
  RequireBeforeRule,
  SelectorValue,
  Severity,
} from "./types.js";

const RULE_TYPES = new Set([
  "max-per-group",
  "require-before",
  "require-after",
  "forbid-text",
  "no-overlap",
]);

export function loadPolicy(path: string): GuardPolicy {
  const sourcePath = resolve(path);
  const raw = readFileSync(sourcePath, "utf8");
  return parsePolicyText(raw, sourcePath);
}

export function parsePolicyText(raw: string, sourcePath = "<inline>"): GuardPolicy {
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourcePath}: policy must be a YAML object`);
  }
  const root = parsed as Record<string, unknown>;
  const version = root.version ?? 1;
  if (version !== 1) {
    throw new Error(`${sourcePath}: version must be 1`);
  }
  if (!Array.isArray(root.rules)) {
    throw new Error(`${sourcePath}: rules must be an array`);
  }

  const rules = root.rules.map((rule, i) => parseRule(rule, `${sourcePath}: rules[${i}]`));
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`${sourcePath}: duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
  }

  return { version: 1, sourcePath, rules };
}

function parseRule(raw: unknown, where: string): GuardRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${where}: rule must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const id = requiredString(r.id, `${where}.id`);
  const type = requiredString(r.type, `${where}.type`);
  if (!RULE_TYPES.has(type)) {
    throw new Error(`${where}.type must be one of: ${[...RULE_TYPES].join(", ")}`);
  }
  const base = {
    id,
    type,
    severity: optionalSeverity(r.severity, `${where}.severity`),
    description: optionalString(r.description, `${where}.description`),
  };

  switch (type) {
    case "max-per-group":
      return {
        ...base,
        type,
        match: parseSelector(r.match, `${where}.match`),
        groupBy: optionalString(r.groupBy, `${where}.groupBy`),
        max: positiveInteger(r.max, `${where}.max`),
      } satisfies MaxPerGroupRule;
    case "require-before":
      return {
        ...base,
        type,
        trigger: parseSelector(r.trigger, `${where}.trigger`),
        require: parseSelector(r.require, `${where}.require`),
        groupBy: optionalString(r.groupBy, `${where}.groupBy`),
      } satisfies RequireBeforeRule;
    case "require-after": {
      if (!Array.isArray(r.require) || r.require.length === 0) {
        throw new Error(`${where}.require must be a non-empty array`);
      }
      return {
        ...base,
        type,
        ifAny: parseSelector(r.ifAny, `${where}.ifAny`),
        require: r.require.map((selector, i) => parseSelector(selector, `${where}.require[${i}]`)),
      } satisfies RequireAfterRule;
    }
    case "forbid-text": {
      if (!Array.isArray(r.patterns) || r.patterns.length === 0) {
        throw new Error(`${where}.patterns must be a non-empty array`);
      }
      return {
        ...base,
        type,
        match: r.match === undefined ? undefined : parseSelector(r.match, `${where}.match`),
        patterns: r.patterns.map((pattern, i) => parseRegexSpec(pattern, `${where}.patterns[${i}]`)),
      } satisfies ForbidTextRule;
    }
    case "no-overlap":
      return {
        ...base,
        type,
        start: parseSelector(r.start, `${where}.start`),
        end: parseSelector(r.end, `${where}.end`),
        keyBy: requiredString(r.keyBy, `${where}.keyBy`),
        requireClosed: optionalBoolean(r.requireClosed, `${where}.requireClosed`),
      } satisfies NoOverlapRule;
  }

  throw new Error(`${where}.type must be one of: ${[...RULE_TYPES].join(", ")}`);
}

function parseSelector(raw: unknown, where: string): EventSelector {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${where} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const out: EventSelector = {};
  if (r.type !== undefined) out.type = parseStringOrStringArray(r.type, `${where}.type`);
  if (r.name !== undefined) out.name = parseStringOrStringArray(r.name, `${where}.name`);
  if (r.text !== undefined) out.text = requiredString(r.text, `${where}.text`);
  if (r.fields !== undefined) out.fields = parseFields(r.fields, `${where}.fields`);
  if (!out.type && !out.name && !out.text && !out.fields) {
    throw new Error(`${where} must specify at least one selector key`);
  }
  return out;
}

function parseFields(raw: unknown, where: string): Record<string, SelectorValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${where} must be an object`);
  }
  const out: Record<string, SelectorValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) throw new Error(`${where}: field name cannot be empty`);
    if (Array.isArray(value)) {
      if (value.length === 0) throw new Error(`${where}.${key} array cannot be empty`);
      out[key] = value.map((v) => scalar(v, `${where}.${key}`));
    } else {
      out[key] = scalar(value, `${where}.${key}`);
    }
  }
  return out;
}

function parseRegexSpec(raw: unknown, where: string): RegexSpec {
  if (typeof raw === "string" && raw) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      source: requiredString(r.source, `${where}.source`),
      flags: optionalString(r.flags, `${where}.flags`),
    };
  }
  throw new Error(`${where} must be a string or { source, flags } object`);
}

function parseStringOrStringArray(raw: unknown, where: string): string | string[] {
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((v) => typeof v === "string" && v)) {
    return raw as string[];
  }
  throw new Error(`${where} must be a non-empty string or string array`);
}

function requiredString(raw: unknown, where: string): string {
  if (typeof raw !== "string" || !raw) throw new Error(`${where} must be a non-empty string`);
  return raw;
}

function optionalString(raw: unknown, where: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  return requiredString(raw, where);
}

function optionalSeverity(raw: unknown, where: string): Severity | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "error" || raw === "warn") return raw;
  throw new Error(`${where} must be "error" or "warn"`);
}

function optionalBoolean(raw: unknown, where: string): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "boolean") return raw;
  throw new Error(`${where} must be true or false`);
}

function positiveInteger(raw: unknown, where: string): number {
  if (!Number.isInteger(raw) || Number(raw) < 1) {
    throw new Error(`${where} must be a positive integer`);
  }
  return Number(raw);
}

function scalar(raw: unknown, where: string): string | number | boolean {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  throw new Error(`${where} must be a string, number, boolean, or array of those`);
}

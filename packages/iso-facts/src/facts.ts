import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { findMatchingFiles, toPosix } from "./glob.js";
import { isJsonObject, isJsonValue, parseJson, stableStringify } from "./json.js";
import type {
  BuildFactsOptions,
  FactCheckResult,
  FactConfig,
  FactFieldSelection,
  FactIssue,
  FactQueryOptions,
  FactRecord,
  FactRequirement,
  FactSet,
  FactSourceConfig,
  FactSourceFormat,
  FactVerifyResult,
  JsonObject,
  JsonValue,
  StructuredFactRule,
  TextFactRule,
} from "./types.js";

export const DEFAULT_FACTS_FILE = ".iso-facts.json";

interface StructuredRow {
  values: Record<string, unknown>;
  line: number;
  pointer?: string;
}

export function loadFactsConfig(input: unknown): FactConfig {
  if (!isObject(input)) throw new Error("facts config must be an object");
  if (input.version !== 1) throw new Error("facts config version must be 1");
  if (!Array.isArray(input.sources)) throw new Error("facts config sources must be an array");
  return {
    version: 1,
    sources: input.sources.map((source, index) => normalizeSource(source, `sources[${index}]`)),
    requirements: input.requirements === undefined ? undefined : normalizeRequirements(input.requirements, "requirements"),
  };
}

export function buildFacts(configInput: FactConfig | unknown, options: BuildFactsOptions = {}): FactSet {
  const config = loadFactsConfig(configInput);
  const root = resolve(options.root || ".");
  const facts: FactRecord[] = [];
  let files = 0;

  for (const source of config.sources) {
    const matched = findMatchingFiles(root, source.include, source.exclude || []);
    files += matched.length;
    for (const path of matched) facts.push(...materializeFile(root, source, path));
  }

  const sorted = facts.sort(compareFacts);
  return {
    schemaVersion: 1,
    root,
    configHash: sha256(stableStringify(config as unknown as JsonObject)),
    stats: {
      sources: config.sources.length,
      files,
      facts: sorted.length,
    },
    facts: sorted,
  };
}

export function queryFacts(factSet: FactSet, options: FactQueryOptions = {}): FactRecord[] {
  const needle = options.text?.toLowerCase();
  const limit = options.limit && options.limit > 0 ? options.limit : undefined;
  const out: FactRecord[] = [];
  for (const fact of factSet.facts || []) {
    if (options.fact && fact.fact !== options.fact) continue;
    if (options.key && fact.key !== options.key) continue;
    if (options.value && fact.value !== options.value) continue;
    if (options.source && !fact.source.path.includes(options.source)) continue;
    if (options.tag && !fact.tags.includes(options.tag)) continue;
    if (needle && !factMatchesText(fact, needle)) continue;
    out.push(fact);
    if (limit && out.length >= limit) break;
  }
  return out;
}

export function hasFact(factSet: FactSet, options: FactQueryOptions = {}): boolean {
  return queryFacts(factSet, { ...options, limit: 1 }).length > 0;
}

export function checkFactRequirements(factSet: FactSet, requirements: FactRequirement[] = []): FactCheckResult {
  const issues: FactCheckResult["issues"] = [];
  for (const requirement of requirements) {
    const count = queryFacts(factSet, requirementToQuery(requirement)).length;
    const min = requirement.min ?? 1;
    if (count < min) {
      issues.push({
        severity: "error",
        kind: "missing-requirement",
        requirement,
        count,
        message: `required fact "${requirement.fact}" expected at least ${min}, found ${count}`,
      });
    }
  }
  return {
    ok: issues.length === 0,
    facts: Array.isArray(factSet.facts) ? factSet.facts.length : 0,
    requirements: requirements.length,
    issues,
  };
}

export function verifyFactSet(factSet: FactSet): FactVerifyResult {
  const issues: FactIssue[] = [];
  if (!isObject(factSet) || factSet.schemaVersion !== 1) {
    return {
      ok: false,
      facts: 0,
      issues: [{ severity: "error", kind: "schema", message: "fact set schemaVersion must be 1" }],
    };
  }
  if (!Array.isArray(factSet.facts)) {
    return {
      ok: false,
      facts: 0,
      issues: [{ severity: "error", kind: "schema", message: "fact set facts must be an array" }],
    };
  }

  const seenIds = new Set<string>();
  for (const fact of factSet.facts) {
    const issuePrefix = fact?.id ? `fact ${fact.id}` : "fact";
    if (!isFactRecord(fact)) {
      issues.push({ severity: "error", kind: "fact-schema", message: `${issuePrefix} is invalid` });
      continue;
    }
    const expected = factId(fact);
    if (fact.id !== expected) {
      issues.push({
        severity: "error",
        kind: "fact-id",
        factId: fact.id,
        message: `fact id does not match content hash; expected ${expected}`,
      });
    }
    if (seenIds.has(fact.id)) {
      issues.push({
        severity: "error",
        kind: "duplicate-id",
        factId: fact.id,
        message: `duplicate fact id ${fact.id}`,
      });
    }
    seenIds.add(fact.id);
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    facts: factSet.facts.length,
    issues,
  };
}

export function factId(fact: Omit<FactRecord, "id">): string {
  const source: JsonObject = {
    name: fact.source.name,
    path: fact.source.path,
    line: fact.source.line,
  };
  if (fact.source.pointer !== undefined) source.pointer = fact.source.pointer;

  const payload: JsonObject = {
    fact: fact.fact,
    source,
    fields: fact.fields,
    tags: fact.tags,
  };
  if (fact.key !== undefined) payload.key = fact.key;
  if (fact.value !== undefined) payload.value = fact.value;
  if (fact.confidence !== undefined) payload.confidence = fact.confidence;
  return sha256(stableStringify(payload));
}

export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([^{}]+)\}/g, (_all, raw: string) => {
    const [path, ...filters] = raw.split("|").map((part) => part.trim()).filter(Boolean);
    let value = valueAtPath(values, path || "");
    for (const filter of filters) value = applyFilter(value, filter);
    return stringifyTemplateValue(value);
  });
}

function materializeFile(root: string, source: FactSourceConfig, path: string): FactRecord[] {
  const format = source.format || "text";
  const text = readFileSync(path, "utf8");
  const relPath = toPosix(relative(root, path));
  if (format === "text") return materializeTextFile(source, relPath, text);
  if (format === "tsv") return materializeDelimitedFile(source, relPath, text, source.delimiter || "\t");
  if (format === "markdown-table") return materializeMarkdownTableFile(source, relPath, text);
  if (format === "jsonl") return materializeJsonlFile(source, relPath, text);
  if (format === "json") return materializeJsonFile(source, relPath, text);
  throw new Error(`unsupported source format: ${format satisfies never}`);
}

function materializeTextFile(source: FactSourceConfig, path: string, text: string): FactRecord[] {
  const rules = source.rules || [];
  const facts: FactRecord[] = [];
  const lines = splitLines(text);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] || "";
    for (const rule of rules) {
      const regex = compileRuleRegex(rule);
      for (const match of line.matchAll(regex)) {
        const values = matchGroups(match);
        facts.push(makeFact(rule, values, source, path, lineIndex + 1));
      }
    }
  }
  return facts;
}

function materializeDelimitedFile(source: FactSourceConfig, path: string, text: string, delimiter: string): FactRecord[] {
  const lines = splitLines(text).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const header = source.header !== false;
  const columns = source.columns || (header ? splitDelimitedLine(lines[0] || "", delimiter) : undefined);
  if (!columns?.length) throw new Error(`source "${source.name}" needs columns for ${path}`);
  const start = header && !source.columns ? 1 : 0;
  const rows: StructuredRow[] = [];
  for (let i = start; i < lines.length; i++) {
    rows.push({
      values: rowFromColumns(columns, splitDelimitedLine(lines[i] || "", delimiter)),
      line: i + 1,
    });
  }
  return materializeRows(source, path, rows);
}

function materializeMarkdownTableFile(source: FactSourceConfig, path: string, text: string): FactRecord[] {
  const lines = splitLines(text);
  const rows: StructuredRow[] = [];
  let headers: string[] | undefined;
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    const next = lines[i + 1] || "";
    if (isMarkdownTableLine(line) && isMarkdownSeparatorLine(next)) {
      headers = parseMarkdownRow(line);
      inTable = true;
      i++;
      continue;
    }
    if (!inTable || !headers) continue;
    if (!isMarkdownTableLine(line)) {
      inTable = false;
      headers = undefined;
      continue;
    }
    if (isMarkdownSeparatorLine(line)) continue;
    rows.push({
      values: rowFromColumns(headers, parseMarkdownRow(line)),
      line: i + 1,
    });
  }
  return materializeRows(source, path, rows);
}

function materializeJsonlFile(source: FactSourceConfig, path: string, text: string): FactRecord[] {
  const rows: StructuredRow[] = [];
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parsed = parseJson(line, `${path}:${i + 1}`);
    if (!isJsonObject(parsed)) throw new Error(`${path}:${i + 1}: JSONL line must be an object`);
    rows.push({
      values: flattenObject(parsed),
      line: i + 1,
      pointer: `/${i}`,
    });
  }
  return materializeRows(source, path, rows);
}

function materializeJsonFile(source: FactSourceConfig, path: string, text: string): FactRecord[] {
  const parsed = parseJson(text, path);
  const facts: FactRecord[] = [];
  for (const rule of source.records || []) {
    for (const item of selectJsonItems(parsed, rule.path || "$")) {
      const values = isJsonObject(item.value)
        ? flattenObject(item.value)
        : { value: item.value };
      facts.push(makeFact(rule, values, source, path, 1, item.pointer));
    }
  }
  return facts;
}

function materializeRows(source: FactSourceConfig, path: string, rows: StructuredRow[]): FactRecord[] {
  const facts: FactRecord[] = [];
  for (const row of rows) {
    for (const rule of source.records || []) {
      facts.push(makeFact(rule, row.values, source, path, row.line, row.pointer));
    }
  }
  return facts;
}

function makeFact(
  rule: TextFactRule | StructuredFactRule,
  values: Record<string, unknown>,
  source: FactSourceConfig,
  path: string,
  line: number,
  pointer?: string,
): FactRecord {
  const context = { ...values, source: path, line, pointer: pointer || "" };
  const key = rule.key ? emptyToUndefined(renderTemplate(rule.key, context)) : undefined;
  const value = rule.value ? emptyToUndefined(renderTemplate(rule.value, context)) : undefined;
  const confidence = rule.confidence === undefined ? undefined : rule.confidence;
  const fact: Omit<FactRecord, "id"> = {
    schemaVersion: 1,
    fact: requireNonEmpty(renderTemplate(rule.fact, context), "fact name"),
    key,
    value,
    source: {
      name: source.name,
      path,
      line,
      ...(pointer ? { pointer } : {}),
    },
    fields: selectFields(values, rule.fields, context),
    tags: [...(rule.tags || [])].sort(),
    ...(confidence === undefined ? {} : { confidence }),
  };
  return { ...fact, id: factId(fact) };
}

function selectFields(
  values: Record<string, unknown>,
  selection: FactFieldSelection | undefined,
  context: Record<string, unknown>,
): JsonObject {
  const fields: JsonObject = {};
  if (!selection) {
    for (const [key, value] of Object.entries(values)) {
      const clean = toJsonValue(value);
      if (clean !== undefined) fields[key] = clean;
    }
    return fields;
  }
  if (Array.isArray(selection)) {
    for (const key of selection) {
      const clean = toJsonValue(valueAtPath(values, key));
      if (clean !== undefined) fields[key] = clean;
    }
    return fields;
  }
  for (const [key, template] of Object.entries(selection)) {
    fields[key] = renderTemplate(template, context);
  }
  return fields;
}

function selectJsonItems(value: JsonValue, selector: string): Array<{ value: JsonValue; pointer: string }> {
  const normalized = selector.trim();
  if (!normalized || normalized === "$") return [{ value, pointer: "" }];
  const raw = normalized.startsWith("$.") ? normalized.slice(2) : normalized.startsWith("$") ? normalized.slice(1).replace(/^\./, "") : normalized;
  if (!raw) return [{ value, pointer: "" }];
  const parts = raw.split(".").filter(Boolean);
  let current: Array<{ value: JsonValue; pointer: string }> = [{ value, pointer: "" }];
  for (const part of parts) {
    const expand = part.endsWith("[]");
    const key = expand ? part.slice(0, -2) : part;
    const next: Array<{ value: JsonValue; pointer: string }> = [];
    for (const item of current) {
      const target = key ? objectValue(item.value, key) : item.value;
      const basePointer = key ? `${item.pointer}/${escapePointer(key)}` : item.pointer;
      if (target === undefined) continue;
      if (expand) {
        if (!Array.isArray(target)) continue;
        target.forEach((entry, index) => next.push({ value: entry, pointer: `${basePointer}/${index}` }));
      } else {
        next.push({ value: target, pointer: basePointer });
      }
    }
    current = next;
  }
  return current;
}

function objectValue(value: JsonValue, key: string): JsonValue | undefined {
  if (!isJsonObject(value)) return undefined;
  return value[key];
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function compileRuleRegex(rule: TextFactRule): RegExp {
  const flags = new Set((rule.flags || "").split("").filter(Boolean));
  flags.add("g");
  return new RegExp(rule.pattern, [...flags].join(""));
}

function matchGroups(match: RegExpMatchArray): Record<string, unknown> {
  const fields: Record<string, unknown> = { "0": match[0] || "" };
  for (let i = 1; i < match.length; i++) fields[String(i)] = match[i] || "";
  for (const [key, value] of Object.entries(match.groups || {})) fields[key] = value;
  return fields;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((cell) => cell.trim());
}

function rowFromColumns(columns: string[], values: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    const key = columns[i]?.trim();
    if (key) row[key] = values[i]?.trim() || "";
  }
  return row;
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|");
}

function isMarkdownSeparatorLine(line: string): boolean {
  if (!isMarkdownTableLine(line)) return false;
  return parseMarkdownRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function flattenObject(value: JsonObject, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (isJsonObject(item)) {
      Object.assign(out, flattenObject(item, next));
    } else {
      out[next] = item;
    }
  }
  return out;
}

function valueAtPath(values: Record<string, unknown>, path: string): unknown {
  if (path in values) return values[path];
  const parts = path.split(".");
  let current: unknown = values;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function applyFilter(value: unknown, filter: string): unknown {
  if (filter === "trim") return String(value ?? "").trim();
  if (filter === "lower") return String(value ?? "").toLowerCase();
  if (filter === "upper") return String(value ?? "").toUpperCase();
  if (filter === "slug") return slugPart(value);
  if (filter === "json") return JSON.stringify(value ?? null);
  throw new Error(`unknown template filter "${filter}"`);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function slugPart(value: unknown): string {
  const slug = String(value ?? "unknown")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

function normalizeSource(input: unknown, label: string): FactSourceConfig {
  if (!isObject(input)) throw new Error(`${label} must be an object`);
  const name = requireString(input.name, `${label}.name`);
  const include = requireStringArray(input.include, `${label}.include`);
  const format = normalizeFormat(input.format, `${label}.format`);
  return {
    name,
    include,
    exclude: input.exclude === undefined ? undefined : requireStringArray(input.exclude, `${label}.exclude`),
    format,
    delimiter: input.delimiter === undefined ? undefined : requireString(input.delimiter, `${label}.delimiter`),
    header: input.header === undefined ? undefined : Boolean(input.header),
    columns: input.columns === undefined ? undefined : requireStringArray(input.columns, `${label}.columns`),
    rules: input.rules === undefined ? undefined : requireTextRules(input.rules, `${label}.rules`),
    records: input.records === undefined ? undefined : requireStructuredRules(input.records, `${label}.records`),
  };
}

function requireTextRules(value: unknown, label: string): TextFactRule[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item)) throw new Error(`${label}[${index}] must be an object`);
    return {
      id: item.id === undefined ? undefined : requireString(item.id, `${label}[${index}].id`),
      fact: requireString(item.fact, `${label}[${index}].fact`),
      pattern: requireString(item.pattern, `${label}[${index}].pattern`),
      flags: item.flags === undefined ? undefined : requireString(item.flags, `${label}[${index}].flags`),
      key: item.key === undefined ? undefined : requireString(item.key, `${label}[${index}].key`),
      value: item.value === undefined ? undefined : requireString(item.value, `${label}[${index}].value`),
      fields: item.fields === undefined ? undefined : requireFieldSelection(item.fields, `${label}[${index}].fields`),
      tags: item.tags === undefined ? undefined : requireStringArray(item.tags, `${label}[${index}].tags`),
      confidence: item.confidence === undefined ? undefined : requireConfidence(item.confidence, `${label}[${index}].confidence`),
    };
  });
}

function requireStructuredRules(value: unknown, label: string): StructuredFactRule[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item)) throw new Error(`${label}[${index}] must be an object`);
    return {
      id: item.id === undefined ? undefined : requireString(item.id, `${label}[${index}].id`),
      fact: requireString(item.fact, `${label}[${index}].fact`),
      path: item.path === undefined ? undefined : requireString(item.path, `${label}[${index}].path`),
      key: item.key === undefined ? undefined : requireString(item.key, `${label}[${index}].key`),
      value: item.value === undefined ? undefined : requireString(item.value, `${label}[${index}].value`),
      fields: item.fields === undefined ? undefined : requireFieldSelection(item.fields, `${label}[${index}].fields`),
      tags: item.tags === undefined ? undefined : requireStringArray(item.tags, `${label}[${index}].tags`),
      confidence: item.confidence === undefined ? undefined : requireConfidence(item.confidence, `${label}[${index}].confidence`),
    };
  });
}

function requireFieldSelection(value: unknown, label: string): FactFieldSelection {
  if (Array.isArray(value)) return requireStringArray(value, label);
  if (isObject(value)) {
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) out[key] = requireString(item, `${label}.${key}`);
    return out;
  }
  throw new Error(`${label} must be an array or object`);
}

function normalizeRequirements(value: unknown, label: string): FactRequirement[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item)) throw new Error(`${label}[${index}] must be an object`);
    return {
      fact: requireString(item.fact, `${label}[${index}].fact`),
      key: item.key === undefined ? undefined : requireString(item.key, `${label}[${index}].key`),
      source: item.source === undefined ? undefined : requireString(item.source, `${label}[${index}].source`),
      tag: item.tag === undefined ? undefined : requireString(item.tag, `${label}[${index}].tag`),
      min: item.min === undefined ? undefined : requirePositiveInteger(item.min, `${label}[${index}].min`),
    };
  });
}

function normalizeFormat(value: unknown, label: string): FactSourceFormat | undefined {
  if (value === undefined) return undefined;
  if (value === "text" || value === "tsv" || value === "markdown-table" || value === "jsonl" || value === "json") return value;
  throw new Error(`${label} must be text, tsv, markdown-table, jsonl, or json`);
}

function requirementToQuery(requirement: FactRequirement): FactQueryOptions {
  return {
    fact: requirement.fact,
    key: requirement.key,
    source: requirement.source,
    tag: requirement.tag,
  };
}

function isFactRecord(value: unknown): value is FactRecord {
  return isObject(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.fact === "string" &&
    (value.key === undefined || typeof value.key === "string") &&
    (value.value === undefined || typeof value.value === "string") &&
    isObject(value.source) &&
    typeof value.source.name === "string" &&
    typeof value.source.path === "string" &&
    Number.isInteger(value.source.line) &&
    (value.source.pointer === undefined || typeof value.source.pointer === "string") &&
    isObject(value.fields) &&
    isJsonValue(value.fields) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    (value.confidence === undefined || (typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1));
}

function factMatchesText(fact: FactRecord, needle: string): boolean {
  const haystack = [
    fact.fact,
    fact.key || "",
    fact.value || "",
    fact.source.name,
    fact.source.path,
    fact.source.pointer || "",
    stableStringify(fact.fields),
    fact.tags.join(" "),
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}

function compareFacts(a: FactRecord, b: FactRecord): number {
  return `${a.fact}\0${a.key || ""}\0${a.value || ""}\0${a.source.path}\0${a.source.line}\0${a.id}`
    .localeCompare(`${b.fact}\0${b.key || ""}\0${b.value || ""}\0${b.source.path}\0${b.source.line}\0${b.id}`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...value];
}

function requireConfidence(value: unknown, label: string): number {
  if (typeof value !== "number" || value < 0 || value > 1) throw new Error(`${label} must be a number from 0 to 1`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function requireNonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must not be empty`);
  return value;
}

function emptyToUndefined(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

function toJsonValue(value: unknown): JsonObject[keyof JsonObject] | undefined {
  if (value === undefined) return undefined;
  if (isJsonValue(value)) return value;
  return String(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

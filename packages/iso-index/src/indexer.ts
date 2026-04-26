import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { findMatchingFiles, toPosix } from "./glob.js";
import { isJsonValue, stableStringify } from "./json.js";
import type {
  ArtifactIndex,
  BuildIndexOptions,
  IndexConfig,
  IndexFieldSelection,
  IndexIssue,
  IndexQueryOptions,
  IndexRecord,
  IndexSourceConfig,
  IndexSourceFormat,
  IndexVerifyResult,
  JsonObject,
  StructuredIndexRule,
  TextIndexRule,
} from "./types.js";

export const DEFAULT_INDEX_FILE = ".iso-index.json";

export function loadIndexConfig(input: unknown): IndexConfig {
  if (!isObject(input)) throw new Error("index config must be an object");
  if (input.version !== 1) throw new Error("index config version must be 1");
  if (!Array.isArray(input.sources)) throw new Error("index config sources must be an array");
  return {
    version: 1,
    sources: input.sources.map((source, index) => normalizeSource(source, `sources[${index}]`)),
  };
}

export function buildIndex(configInput: IndexConfig | unknown, options: BuildIndexOptions = {}): ArtifactIndex {
  const config = loadIndexConfig(configInput);
  const root = resolve(options.root || ".");
  const records: IndexRecord[] = [];
  let files = 0;

  for (const source of config.sources) {
    const matched = findMatchingFiles(root, source.include, source.exclude || []);
    files += matched.length;
    for (const path of matched) {
      records.push(...indexFile(root, source, path));
    }
  }

  const sorted = records.sort(compareRecords);
  return {
    schemaVersion: 1,
    root,
    configHash: sha256(stableStringify(config)),
    stats: {
      sources: config.sources.length,
      files,
      records: sorted.length,
    },
    records: sorted,
  };
}

export function queryIndex(index: ArtifactIndex, options: IndexQueryOptions = {}): IndexRecord[] {
  const needle = options.text?.toLowerCase();
  const limit = options.limit && options.limit > 0 ? options.limit : undefined;
  const out: IndexRecord[] = [];
  for (const record of index.records) {
    if (options.kind && record.kind !== options.kind) continue;
    if (options.key && record.key !== options.key) continue;
    if (options.value && record.value !== options.value) continue;
    if (options.source && !record.source.path.includes(options.source)) continue;
    if (needle && !recordMatchesText(record, needle)) continue;
    out.push(record);
    if (limit && out.length >= limit) break;
  }
  return out;
}

export function hasIndexRecord(index: ArtifactIndex, options: IndexQueryOptions = {}): boolean {
  return queryIndex(index, { ...options, limit: 1 }).length > 0;
}

export function verifyIndex(index: ArtifactIndex): IndexVerifyResult {
  const issues: IndexIssue[] = [];
  if (!isObject(index) || index.schemaVersion !== 1) {
    return {
      ok: false,
      records: 0,
      issues: [{ severity: "error", kind: "schema", message: "index schemaVersion must be 1" }],
    };
  }
  const seenIds = new Set<string>();
  for (const record of index.records || []) {
    const issuePrefix = record?.id ? `record ${record.id}` : "record";
    if (!isRecord(record)) {
      issues.push({ severity: "error", kind: "record-schema", message: `${issuePrefix} is invalid` });
      continue;
    }
    const expected = recordId(record);
    if (record.id !== expected) {
      issues.push({
        severity: "error",
        kind: "record-id",
        recordId: record.id,
        message: `record id does not match content hash; expected ${expected}`,
      });
    }
    if (seenIds.has(record.id)) {
      issues.push({
        severity: "error",
        kind: "duplicate-id",
        recordId: record.id,
        message: `duplicate record id ${record.id}`,
      });
    }
    seenIds.add(record.id);
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    records: Array.isArray(index.records) ? index.records.length : 0,
    issues,
  };
}

function indexFile(root: string, source: IndexSourceConfig, path: string): IndexRecord[] {
  const format = source.format || "text";
  const text = readFileSync(path, "utf8");
  const relPath = toPosix(relative(root, path));
  if (format === "text") return indexTextFile(source, relPath, text);
  if (format === "tsv") return indexDelimitedFile(source, relPath, text, source.delimiter || "\t");
  if (format === "markdown-table") return indexMarkdownTableFile(source, relPath, text);
  if (format === "jsonl") return indexJsonlFile(source, relPath, text);
  throw new Error(`unsupported source format: ${format satisfies never}`);
}

function indexTextFile(source: IndexSourceConfig, path: string, text: string): IndexRecord[] {
  const rules = source.rules || [];
  const records: IndexRecord[] = [];
  const lines = splitLines(text);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] || "";
    for (const rule of rules) {
      const regex = compileRuleRegex(rule);
      for (const match of line.matchAll(regex)) {
        const groups = matchGroups(match);
        records.push(makeRecord(rule, groups, source, path, lineIndex + 1));
      }
    }
  }
  return records;
}

function indexDelimitedFile(source: IndexSourceConfig, path: string, text: string, delimiter: string): IndexRecord[] {
  const lines = splitLines(text).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const header = source.header !== false;
  const columns = source.columns || (header ? splitDelimitedLine(lines[0] || "", delimiter) : undefined);
  if (!columns?.length) throw new Error(`source "${source.name}" needs columns for ${path}`);
  const start = header && !source.columns ? 1 : 0;
  const records: IndexRecord[] = [];
  for (let i = start; i < lines.length; i++) {
    const values = splitDelimitedLine(lines[i] || "", delimiter);
    const row = rowFromColumns(columns, values);
    for (const rule of source.records || []) {
      records.push(makeRecord(rule, row, source, path, i + 1));
    }
  }
  return records;
}

function indexMarkdownTableFile(source: IndexSourceConfig, path: string, text: string): IndexRecord[] {
  const lines = splitLines(text);
  const records: IndexRecord[] = [];
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
    const row = rowFromColumns(headers, parseMarkdownRow(line));
    for (const rule of source.records || []) {
      records.push(makeRecord(rule, row, source, path, i + 1));
    }
  }
  return records;
}

function indexJsonlFile(source: IndexSourceConfig, path: string, text: string): IndexRecord[] {
  const records: IndexRecord[] = [];
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parsed = JSON.parse(line) as unknown;
    if (!isObject(parsed)) throw new Error(`${path}:${i + 1}: JSONL line must be an object`);
    const row = flattenObject(parsed);
    for (const rule of source.records || []) {
      records.push(makeRecord(rule, row, source, path, i + 1));
    }
  }
  return records;
}

function makeRecord(
  rule: TextIndexRule | StructuredIndexRule,
  values: Record<string, unknown>,
  source: IndexSourceConfig,
  path: string,
  line: number,
): IndexRecord {
  const context = { ...values, source: path, line };
  const record: Omit<IndexRecord, "id"> = {
    schemaVersion: 1,
    kind: requireNonEmpty(renderTemplate(rule.kind, context), "record kind"),
    key: requireNonEmpty(renderTemplate(rule.key, context), "record key"),
    value: rule.value ? renderTemplate(rule.value, context) : undefined,
    source: { name: source.name, path, line },
    fields: selectFields(values, rule.fields, context),
    tags: [...(rule.tags || [])].sort(),
  };
  return { ...record, id: recordId(record) };
}

export function recordId(record: Omit<IndexRecord, "id">): string {
  return sha256(stableStringify({
    kind: record.kind,
    key: record.key,
    value: record.value,
    source: record.source,
    fields: record.fields,
    tags: record.tags,
  }));
}

export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([^{}]+)\}/g, (_all, raw: string) => {
    const [path, ...filters] = raw.split("|").map((part) => part.trim()).filter(Boolean);
    let value = valueAtPath(values, path || "");
    for (const filter of filters) value = applyFilter(value, filter);
    return stringifyTemplateValue(value);
  });
}

function selectFields(
  values: Record<string, unknown>,
  selection: IndexFieldSelection | undefined,
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

function compileRuleRegex(rule: TextIndexRule): RegExp {
  const flags = new Set((rule.flags || "").split(""));
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

function flattenObject(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (isObject(item) && !Array.isArray(item)) {
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

function normalizeSource(input: unknown, label: string): IndexSourceConfig {
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

function requireTextRules(value: unknown, label: string): TextIndexRule[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item)) throw new Error(`${label}[${index}] must be an object`);
    return {
      kind: requireString(item.kind, `${label}[${index}].kind`),
      pattern: requireString(item.pattern, `${label}[${index}].pattern`),
      flags: item.flags === undefined ? undefined : requireString(item.flags, `${label}[${index}].flags`),
      key: requireString(item.key, `${label}[${index}].key`),
      value: item.value === undefined ? undefined : requireString(item.value, `${label}[${index}].value`),
      fields: item.fields === undefined ? undefined : requireFieldSelection(item.fields, `${label}[${index}].fields`),
      tags: item.tags === undefined ? undefined : requireStringArray(item.tags, `${label}[${index}].tags`),
    };
  });
}

function requireStructuredRules(value: unknown, label: string): StructuredIndexRule[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item)) throw new Error(`${label}[${index}] must be an object`);
    return {
      kind: requireString(item.kind, `${label}[${index}].kind`),
      key: requireString(item.key, `${label}[${index}].key`),
      value: item.value === undefined ? undefined : requireString(item.value, `${label}[${index}].value`),
      fields: item.fields === undefined ? undefined : requireFieldSelection(item.fields, `${label}[${index}].fields`),
      tags: item.tags === undefined ? undefined : requireStringArray(item.tags, `${label}[${index}].tags`),
    };
  });
}

function requireFieldSelection(value: unknown, label: string): IndexFieldSelection {
  if (Array.isArray(value)) return requireStringArray(value, label);
  if (isObject(value)) {
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) out[key] = requireString(item, `${label}.${key}`);
    return out;
  }
  throw new Error(`${label} must be an array or object`);
}

function normalizeFormat(value: unknown, label: string): IndexSourceFormat | undefined {
  if (value === undefined) return undefined;
  if (value === "text" || value === "tsv" || value === "markdown-table" || value === "jsonl") return value;
  throw new Error(`${label} must be text, tsv, markdown-table, or jsonl`);
}

function isRecord(value: unknown): value is IndexRecord {
  return isObject(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.key === "string" &&
    (value.value === undefined || typeof value.value === "string") &&
    isObject(value.source) &&
    typeof value.source.name === "string" &&
    typeof value.source.path === "string" &&
    Number.isInteger(value.source.line) &&
    isObject(value.fields) &&
    isJsonValue(value.fields) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string");
}

function recordMatchesText(record: IndexRecord, needle: string): boolean {
  const haystack = [
    record.kind,
    record.key,
    record.value || "",
    record.source.name,
    record.source.path,
    stableStringify(record.fields),
    record.tags.join(" "),
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}

function compareRecords(a: IndexRecord, b: IndexRecord): number {
  return `${a.kind}\0${a.key}\0${a.source.path}\0${a.source.line}\0${a.id}`
    .localeCompare(`${b.kind}\0${b.key}\0${b.source.path}\0${b.source.line}\0${b.id}`);
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

function requireNonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must not be empty`);
  return value;
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

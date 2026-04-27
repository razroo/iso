import { BUILTIN_PATTERNS, DEFAULT_BUILTINS } from "./builtins.js";
import { isJsonObject } from "./json.js";
import type {
  RedactApplyResult,
  RedactBuiltinRule,
  RedactBuiltinRuleInput,
  RedactConfig,
  RedactDefaults,
  RedactFieldRule,
  RedactFinding,
  RedactPatternRule,
  RedactRuleKind,
  RedactRuleSummary,
  RedactScanOptions,
  RedactScanResult,
  RedactSeverity,
  RedactSource,
  RedactTotals,
} from "./types.js";

const DEFAULT_REPLACEMENT = "[REDACTED:{id}]";
const DEFAULT_SEVERITY: RedactSeverity = "error";
const SEVERITIES = new Set(["info", "warn", "error"]);

interface CompiledPatternRule {
  id: string;
  label: string;
  kind: "builtin" | "pattern";
  severity: RedactSeverity;
  replacement: string;
  pattern: string;
  flags: string;
}

interface CompiledFieldRule {
  id: string;
  label: string;
  kind: "field";
  severity: RedactSeverity;
  replacement: string;
  names: string[];
  matcher: RegExp;
}

type CompiledRule = CompiledPatternRule | CompiledFieldRule;

export function loadRedactConfig(input: unknown): RedactConfig {
  if (!isJsonObject(input)) throw new Error("redact config must be an object");
  if (input.version !== 1) throw new Error("redact config version must be 1");
  const defaults = normalizeDefaults(input.defaults);
  return {
    version: 1,
    defaults,
    builtins: normalizeBuiltins(input.builtins, defaults),
    patterns: normalizePatterns(input.patterns),
    fields: normalizeFields(input.fields),
  };
}

export function listRedactRules(configInput: RedactConfig | unknown): RedactRuleSummary[] {
  return compileRules(loadRedactConfig(configInput)).map((rule) => ({
    id: rule.id,
    label: rule.label,
    kind: rule.kind,
    severity: rule.severity,
    replacement: rule.replacement,
  }));
}

export function scanText(configInput: RedactConfig | unknown, text: string, options: RedactScanOptions = {}): RedactScanResult {
  return scanSources(configInput, [{ name: options.source ?? "<input>", text }]);
}

export function scanSources(configInput: RedactConfig | unknown, sources: RedactSource[]): RedactScanResult {
  const config = loadRedactConfig(configInput);
  const rules = compileRules(config);
  const findings = sources.flatMap((source) => scanSource(rules, source));
  const sorted = sortFindings(findings);
  return {
    ok: sorted.length === 0,
    sources: sources.map((source) => source.name),
    findings: sorted,
    totals: computeTotals(sources, sorted),
  };
}

export function redactText(configInput: RedactConfig | unknown, text: string, options: RedactScanOptions = {}): RedactApplyResult {
  const source = options.source ?? "<input>";
  const result = scanSources(configInput, [{ name: source, text }]);
  const redacted = applyFindings(text, result.findings.filter((finding) => finding.source === source));
  return {
    source,
    changed: redacted !== text,
    text: redacted,
    findings: result.findings,
    totals: result.totals,
  };
}

function normalizeDefaults(input: unknown): RedactDefaults {
  if (input === undefined) return { severity: DEFAULT_SEVERITY, replacement: DEFAULT_REPLACEMENT };
  if (!isJsonObject(input)) throw new Error("redact config defaults must be an object");
  return {
    severity: optionalSeverity(input.severity, "defaults.severity") ?? DEFAULT_SEVERITY,
    replacement: optionalString(input.replacement, "defaults.replacement") ?? DEFAULT_REPLACEMENT,
  };
}

function normalizeBuiltins(input: unknown, defaults: RedactDefaults): RedactBuiltinRule[] {
  const raw = input === undefined ? DEFAULT_BUILTINS : input;
  if (!Array.isArray(raw)) throw new Error("redact config builtins must be an array");
  return raw.map((item, index) => normalizeBuiltin(item, `builtins[${index}]`, defaults));
}

function normalizeBuiltin(input: unknown, label: string, defaults: RedactDefaults): RedactBuiltinRule {
  let rule: RedactBuiltinRuleInput;
  if (typeof input === "string") rule = input;
  else if (isJsonObject(input)) {
    rule = {
      id: requireString(input.id, `${label}.id`),
      enabled: optionalBoolean(input.enabled, `${label}.enabled`),
      label: optionalString(input.label, `${label}.label`),
      severity: optionalSeverity(input.severity, `${label}.severity`),
      replacement: optionalString(input.replacement, `${label}.replacement`),
    };
  } else {
    throw new Error(`${label} must be a string or object`);
  }

  const id = typeof rule === "string" ? rule : rule.id;
  if (!BUILTIN_PATTERNS[id]) throw new Error(`${label} unknown builtin "${id}"`);
  return typeof rule === "string"
    ? { id, enabled: true, severity: undefined, replacement: undefined }
    : {
      id,
      enabled: rule.enabled ?? true,
      label: rule.label,
      severity: rule.severity ?? defaults.severity,
      replacement: rule.replacement,
    };
}

function normalizePatterns(input: unknown): RedactPatternRule[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("redact config patterns must be an array");
  return input.map((pattern, index) => normalizePattern(pattern, `patterns[${index}]`));
}

function normalizePattern(input: unknown, label: string): RedactPatternRule {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    label: optionalString(input.label, `${label}.label`),
    pattern: requireString(input.pattern, `${label}.pattern`),
    flags: normalizeFlags(optionalString(input.flags, `${label}.flags`) ?? "g", `${label}.flags`),
    severity: optionalSeverity(input.severity, `${label}.severity`),
    replacement: optionalString(input.replacement, `${label}.replacement`),
  };
}

function normalizeFields(input: unknown): RedactFieldRule[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("redact config fields must be an array");
  return input.map((field, index) => normalizeField(field, `fields[${index}]`));
}

function normalizeField(input: unknown, label: string): RedactFieldRule {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  const names = optionalStringArray(input.names, `${label}.names`) ?? [];
  if (!names.length) throw new Error(`${label}.names must contain at least one name`);
  return {
    id: requireString(input.id, `${label}.id`),
    label: optionalString(input.label, `${label}.label`),
    names,
    severity: optionalSeverity(input.severity, `${label}.severity`),
    replacement: optionalString(input.replacement, `${label}.replacement`),
  };
}

function compileRules(config: RedactConfig): CompiledRule[] {
  const rules: CompiledRule[] = [];
  for (const builtin of config.builtins) {
    if (!builtin.enabled) continue;
    const definition = BUILTIN_PATTERNS[builtin.id];
    if (!definition) throw new Error(`unknown builtin "${builtin.id}"`);
    const severity = builtin.severity ?? definition.severity ?? config.defaults.severity;
    const replacement = renderReplacement(builtin.replacement ?? definition.replacement ?? config.defaults.replacement, builtin.id);
    compileRegex(definition.pattern, definition.flags, builtin.id);
    rules.push({
      id: builtin.id,
      label: builtin.label ?? definition.label,
      kind: "builtin",
      severity,
      replacement,
      pattern: definition.pattern,
      flags: normalizeFlags(definition.flags, `builtin ${builtin.id}`),
    });
  }
  for (const pattern of config.patterns) {
    compileRegex(pattern.pattern, pattern.flags, pattern.id);
    rules.push({
      id: pattern.id,
      label: pattern.label ?? pattern.id,
      kind: "pattern",
      severity: pattern.severity ?? config.defaults.severity,
      replacement: renderReplacement(pattern.replacement ?? config.defaults.replacement, pattern.id),
      pattern: pattern.pattern,
      flags: normalizeFlags(pattern.flags, `patterns.${pattern.id}.flags`),
    });
  }
  for (const field of config.fields) {
    const matcher = compileFieldMatcher(field.names);
    rules.push({
      id: field.id,
      label: field.label ?? field.id,
      kind: "field",
      severity: field.severity ?? config.defaults.severity,
      replacement: renderReplacement(field.replacement ?? config.defaults.replacement, field.id),
      names: field.names,
      matcher,
    });
  }
  return rules;
}

function scanSource(rules: CompiledRule[], source: RedactSource): RedactFinding[] {
  const lineStarts = computeLineStarts(source.text);
  const raw = rules.flatMap((rule) => rule.kind === "field"
    ? scanFieldRule(rule, source, lineStarts)
    : scanPatternRule(rule, source, lineStarts));
  return selectNonOverlapping(raw);
}

function scanPatternRule(rule: CompiledPatternRule, source: RedactSource, lineStarts: number[]): RedactFinding[] {
  const findings: RedactFinding[] = [];
  const regex = compileRegex(rule.pattern, rule.flags, rule.id);
  for (let match = regex.exec(source.text); match; match = regex.exec(source.text)) {
    if (!match[0]) {
      regex.lastIndex += 1;
      continue;
    }
    findings.push(makeFinding(source, lineStarts, rule, match.index, match.index + match[0].length));
  }
  return findings;
}

function scanFieldRule(rule: CompiledFieldRule, source: RedactSource, lineStarts: number[]): RedactFinding[] {
  const findings: RedactFinding[] = [];
  let offset = 0;
  const lines = source.text.match(/.*(?:\r?\n|$)/g) ?? [];
  for (const rawLine of lines) {
    if (!rawLine) continue;
    const line = rawLine.replace(/\r?\n$/, "");
    rule.matcher.lastIndex = 0;
    for (let match = rule.matcher.exec(line); match; match = rule.matcher.exec(line)) {
      const valueStart = match.index + match[0].length;
      const span = findFieldValueSpan(line, valueStart);
      if (!span) continue;
      if (isRedactionMarker(line.slice(span.start, span.end))) continue;
      findings.push(makeFinding(source, lineStarts, rule, offset + span.start, offset + span.end));
    }
    offset += rawLine.length;
  }
  return findings;
}

function isRedactionMarker(value: string): boolean {
  return /^\[REDACTED:[A-Za-z0-9_.:-]+\]$/.test(value);
}

function findFieldValueSpan(line: string, start: number): { start: number; end: number } | undefined {
  let cursor = start;
  while (cursor < line.length && /\s/.test(line[cursor] ?? "")) cursor += 1;
  if (cursor >= line.length) return undefined;
  const first = line[cursor];
  if (first === "{" || first === "[") return undefined;
  if (first === "\"" || first === "'") {
    const end = line.indexOf(first, cursor + 1);
    if (end <= cursor + 1) return undefined;
    return { start: cursor + 1, end };
  }
  let end = cursor;
  while (end < line.length && !/[\s,}\]#]/.test(line[end] ?? "")) end += 1;
  if (end <= cursor) return undefined;
  return { start: cursor, end };
}

function selectNonOverlapping(findings: RedactFinding[]): RedactFinding[] {
  const selected: RedactFinding[] = [];
  for (const finding of sortFindings(findings)) {
    const prior = selected[selected.length - 1];
    if (prior && prior.source === finding.source && finding.start < prior.end) continue;
    selected.push(finding);
  }
  return selected;
}

function sortFindings(findings: RedactFinding[]): RedactFinding[] {
  return [...findings].sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.start - b.start ||
    b.length - a.length ||
    kindPriority(a.kind) - kindPriority(b.kind) ||
    a.ruleId.localeCompare(b.ruleId));
}

function kindPriority(kind: RedactRuleKind): number {
  if (kind === "builtin") return 0;
  if (kind === "field") return 1;
  return 2;
}

function applyFindings(text: string, findings: RedactFinding[]): string {
  let next = text;
  for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, finding.start)}${finding.replacement}${next.slice(finding.end)}`;
  }
  return next;
}

function makeFinding(
  source: RedactSource,
  lineStarts: number[],
  rule: Pick<CompiledRule, "id" | "label" | "kind" | "severity" | "replacement">,
  start: number,
  end: number,
): RedactFinding {
  const position = locatePosition(lineStarts, start);
  const length = end - start;
  return {
    source: source.name,
    ruleId: rule.id,
    label: rule.label,
    kind: rule.kind,
    severity: rule.severity,
    start,
    end,
    line: position.line,
    column: position.column,
    length,
    preview: `<redacted ${length} char${length === 1 ? "" : "s"}>`,
    replacement: rule.replacement,
  };
}

function computeTotals(sources: RedactSource[], findings: RedactFinding[]): RedactTotals {
  const byRule: Record<string, number> = {};
  const bySeverity: Record<RedactSeverity, number> = { info: 0, warn: 0, error: 0 };
  for (const finding of findings) {
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
    bySeverity[finding.severity] += 1;
  }
  return {
    sources: sources.length,
    findings: findings.length,
    byRule,
    bySeverity,
  };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function locatePosition(lineStarts: number[], index: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid] ?? 0;
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (index < start) high = mid - 1;
    else if (index >= next) low = mid + 1;
    else return { line: mid + 1, column: index - start + 1 };
  }
  return { line: 1, column: index + 1 };
}

function compileFieldMatcher(names: string[]): RegExp {
  const alternatives = names.map(escapeRegExp).join("|");
  return new RegExp(`(^|[\\s,{])(["']?(?:${alternatives})["']?\\s*[:=]\\s*)`, "gi");
}

function compileRegex(pattern: string, flags: string, id: string): RegExp {
  try {
    return new RegExp(pattern, normalizeFlags(flags, `${id}.flags`));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid regexp for "${id}": ${detail}`);
  }
}

function normalizeFlags(flags: string, label: string): string {
  let next = "";
  for (const flag of flags) {
    if (!"dgimsuvy".includes(flag)) throw new Error(`${label} contains unsupported regexp flag "${flag}"`);
    if (!next.includes(flag)) next += flag;
  }
  return next.includes("g") ? next : `${next}g`;
}

function renderReplacement(template: string, id: string): string {
  return template.replaceAll("{id}", id);
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalSeverity(value: unknown, label: string): RedactSeverity | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SEVERITIES.has(value)) throw new Error(`${label} must be one of: info, warn, error`);
  return value as RedactSeverity;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

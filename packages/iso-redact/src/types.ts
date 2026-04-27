export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type RedactSeverity = "info" | "warn" | "error";
export type RedactRuleKind = "builtin" | "pattern" | "field";

export interface RedactConfig {
  version: 1;
  defaults: RedactDefaults;
  builtins: RedactBuiltinRule[];
  patterns: RedactPatternRule[];
  fields: RedactFieldRule[];
}

export interface RedactDefaults {
  severity: RedactSeverity;
  replacement: string;
}

export type RedactBuiltinRuleInput = string | RedactBuiltinRuleObject;

export interface RedactBuiltinRuleObject {
  id: string;
  enabled?: boolean;
  label?: string;
  severity?: RedactSeverity;
  replacement?: string;
}

export interface RedactBuiltinRule {
  id: string;
  enabled: boolean;
  label?: string;
  severity?: RedactSeverity;
  replacement?: string;
}

export interface RedactPatternRule {
  id: string;
  label?: string;
  pattern: string;
  flags: string;
  severity?: RedactSeverity;
  replacement?: string;
}

export interface RedactFieldRule {
  id: string;
  label?: string;
  names: string[];
  severity?: RedactSeverity;
  replacement?: string;
}

export interface RedactSource {
  name: string;
  text: string;
}

export interface RedactScanOptions {
  source?: string;
}

export interface RedactFinding {
  source: string;
  ruleId: string;
  label: string;
  kind: RedactRuleKind;
  severity: RedactSeverity;
  start: number;
  end: number;
  line: number;
  column: number;
  length: number;
  preview: string;
  replacement: string;
}

export interface RedactTotals {
  sources: number;
  findings: number;
  byRule: Record<string, number>;
  bySeverity: Record<RedactSeverity, number>;
}

export interface RedactScanResult {
  ok: boolean;
  sources: string[];
  findings: RedactFinding[];
  totals: RedactTotals;
}

export interface RedactApplyResult {
  source: string;
  changed: boolean;
  text: string;
  findings: RedactFinding[];
  totals: RedactTotals;
}

export interface RedactRuleSummary {
  id: string;
  label: string;
  kind: RedactRuleKind;
  severity: RedactSeverity;
  replacement: string;
}

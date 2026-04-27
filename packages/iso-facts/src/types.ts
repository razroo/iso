export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type FactSourceFormat = "text" | "tsv" | "markdown-table" | "jsonl" | "json";

export interface FactsConfig {
  version: 1;
  sources: FactSourceConfig[];
  requirements?: FactRequirement[];
}

export type FactConfig = FactsConfig;

export interface FactSourceConfig {
  name: string;
  include: string[];
  exclude?: string[];
  format?: FactSourceFormat;
  delimiter?: string;
  header?: boolean;
  columns?: string[];
  rules?: TextFactRule[];
  records?: StructuredFactRule[];
}

export interface TextFactRule {
  id?: string;
  fact: string;
  pattern: string;
  flags?: string;
  key?: string;
  value?: string;
  fields?: FactFieldSelection;
  tags?: string[];
  confidence?: number;
}

export interface StructuredFactRule {
  id?: string;
  fact: string;
  path?: string;
  key?: string;
  value?: string;
  fields?: FactFieldSelection;
  tags?: string[];
  confidence?: number;
}

export type FactRule = TextFactRule | StructuredFactRule;
export type FactFieldSelection = string[] | Record<string, string>;

export interface FactRequirement {
  fact: string;
  key?: string;
  source?: string;
  tag?: string;
  min?: number;
}

export interface FactSourceRef {
  name: string;
  path: string;
  line: number;
  pointer?: string;
}

export interface FactRecord {
  schemaVersion: 1;
  id: string;
  fact: string;
  key?: string;
  value?: string;
  source: FactSourceRef;
  fields: JsonObject;
  tags: string[];
  confidence?: number;
}

export interface FactSet {
  schemaVersion: 1;
  root: string;
  configHash: string;
  stats: FactStats;
  facts: FactRecord[];
}

export interface FactStats {
  sources: number;
  files: number;
  facts: number;
}

export interface BuildFactsOptions {
  root?: string;
}

export interface FactQueryOptions {
  text?: string;
  fact?: string;
  key?: string;
  value?: string;
  source?: string;
  tag?: string;
  limit?: number;
}

export interface FactIssue {
  severity: "error" | "warn";
  kind: string;
  message: string;
  factId?: string;
}

export interface FactVerifyResult {
  ok: boolean;
  facts: number;
  issues: FactIssue[];
}

export interface FactCheckIssue {
  severity: "error" | "warn";
  kind: "missing-requirement";
  message: string;
  requirement: FactRequirement;
  count: number;
}

export interface FactCheckResult {
  ok: boolean;
  facts: number;
  requirements: number;
  issues: FactCheckIssue[];
}

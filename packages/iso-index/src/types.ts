export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type IndexSourceFormat = "text" | "tsv" | "markdown-table" | "jsonl";

export interface IndexConfig {
  version: 1;
  sources: IndexSourceConfig[];
}

export interface IndexSourceConfig {
  name: string;
  include: string[];
  exclude?: string[];
  format?: IndexSourceFormat;
  delimiter?: string;
  header?: boolean;
  columns?: string[];
  rules?: TextIndexRule[];
  records?: StructuredIndexRule[];
}

export interface TextIndexRule {
  kind: string;
  pattern: string;
  flags?: string;
  key: string;
  value?: string;
  fields?: IndexFieldSelection;
  tags?: string[];
}

export interface StructuredIndexRule {
  kind: string;
  key: string;
  value?: string;
  fields?: IndexFieldSelection;
  tags?: string[];
}

export type IndexFieldSelection = string[] | Record<string, string>;

export interface IndexSourceRef {
  name: string;
  path: string;
  line: number;
}

export interface IndexRecord {
  schemaVersion: 1;
  id: string;
  kind: string;
  key: string;
  value?: string;
  source: IndexSourceRef;
  fields: JsonObject;
  tags: string[];
}

export interface ArtifactIndex {
  schemaVersion: 1;
  root: string;
  configHash: string;
  stats: IndexStats;
  records: IndexRecord[];
}

export interface IndexStats {
  sources: number;
  files: number;
  records: number;
}

export interface BuildIndexOptions {
  root?: string;
}

export interface IndexQueryOptions {
  text?: string;
  kind?: string;
  key?: string;
  value?: string;
  source?: string;
  limit?: number;
}

export interface IndexIssue {
  severity: "error" | "warn";
  kind: string;
  message: string;
  recordId?: string;
}

export interface IndexVerifyResult {
  ok: boolean;
  records: number;
  issues: IndexIssue[];
}

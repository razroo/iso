export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface LineageGraph {
  schemaVersion: 1;
  id: string;
  records: LineageRecord[];
}

export interface LineageRecord {
  id: string;
  artifact: LineageSnapshot;
  inputs: LineageInput[];
  command?: string;
  createdAt?: string;
  metadata?: JsonObject;
}

export interface LineageSnapshot {
  path: string;
  hash?: string;
  size?: number;
  kind?: string;
  missing?: boolean;
}

export interface LineageInput extends LineageSnapshot {
  role?: string;
  optional?: boolean;
}

export interface RecordLineageOptions {
  root?: string;
  artifact: string;
  kind?: string;
  inputs?: string[];
  optionalInputs?: string[];
  command?: string;
  metadata?: JsonObject;
  now?: Date | string;
}

export interface CheckLineageOptions {
  root?: string;
  artifact?: string;
}

export type LineageRecordState = "current" | "stale" | "missing";

export type LineageIssueSeverity = "error" | "warn";

export interface LineageIssue {
  severity: LineageIssueSeverity;
  code: string;
  message: string;
  artifact?: string;
  input?: string;
}

export interface LineageInputCheck {
  input: LineageInput;
  current?: LineageSnapshot;
  state: "current" | "stale" | "missing";
  issues: LineageIssue[];
}

export interface LineageRecordCheck {
  record: LineageRecord;
  state: LineageRecordState;
  artifact?: LineageSnapshot;
  inputs: LineageInputCheck[];
  issues: LineageIssue[];
}

export interface LineageCheckResult {
  ok: boolean;
  graphId: string;
  total: number;
  current: number;
  stale: number;
  missing: number;
  records: LineageRecordCheck[];
  issues: LineageIssue[];
}

export interface LineageVerifyResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: LineageIssue[];
}

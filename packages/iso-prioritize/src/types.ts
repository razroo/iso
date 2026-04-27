export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface PrioritizeConfig {
  version: 1;
  defaults?: PrioritizeDefaults;
  profiles: PrioritizeProfile[];
}

export interface PrioritizeDefaults {
  profile?: string;
  limit?: number;
}

export interface PrioritizeProfile {
  name: string;
  description?: string;
  limit?: number;
  criteria: PrioritizeCriterion[];
  gates?: PrioritizeGate[];
  adjustments?: PrioritizeAdjustment[];
  quotas?: PrioritizeQuota[];
}

export interface PrioritizeCriterion {
  id: string;
  label?: string;
  field: string;
  weight: number;
  direction?: "desc" | "asc";
  min?: number;
  max?: number;
  default?: number;
  required?: boolean;
}

export interface PrioritizeMatcher {
  type?: string | string[];
  key?: string | string[];
  tag?: string | string[];
  where?: Record<string, JsonPrimitive | JsonPrimitive[]>;
}

export interface PrioritizeGate {
  id: string;
  action: "skip" | "block";
  reason: string;
  when: PrioritizeMatcher;
}

export interface PrioritizeAdjustment {
  id: string;
  value: number;
  reason: string;
  when: PrioritizeMatcher;
}

export interface PrioritizeQuota {
  id: string;
  field: string;
  max: number;
  reason?: string;
}

export interface PrioritizeItem {
  id: string;
  key?: string;
  type?: string;
  title?: string;
  tags?: string[];
  data?: JsonObject;
  source?: PrioritizeSource;
}

export interface PrioritizeSource {
  path?: string;
  line?: number;
}

export type PrioritizedItemState = "selected" | "candidate" | "skipped" | "blocked";

export interface CriterionContribution {
  id: string;
  label: string;
  field: string;
  weight: number;
  direction: "desc" | "asc";
  raw: number | null;
  normalized: number;
  contribution: number;
  missing?: boolean;
}

export interface AppliedAdjustment {
  id: string;
  value: number;
  reason: string;
}

export interface PrioritizedItem {
  id: string;
  rank?: number;
  state: PrioritizedItemState;
  score: number;
  normalized: number;
  key?: string;
  type?: string;
  title?: string;
  item: PrioritizeItem;
  contributions: CriterionContribution[];
  adjustments: AppliedAdjustment[];
  reasons: string[];
}

export interface PrioritizeStats {
  total: number;
  selected: number;
  candidate: number;
  skipped: number;
  blocked: number;
}

export type IssueSeverity = "error" | "warn";

export interface PrioritizeIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  item?: string;
  profile?: string;
  path?: string;
}

export interface PrioritizeResult {
  schemaVersion: 1;
  id: string;
  profile: string;
  limit: number;
  items: PrioritizedItem[];
  stats: PrioritizeStats;
  issues: PrioritizeIssue[];
}

export interface PrioritizeOptions {
  profile?: string;
  limit?: number;
}

export interface PrioritizeCheckOptions extends PrioritizeOptions {
  minSelected?: number;
  failOn?: PrioritizedItemState[] | "none";
}

export interface PrioritizeCheckResult {
  ok: boolean;
  errors: number;
  warnings: number;
  minSelected: number;
  failOn: PrioritizedItemState[];
  result: PrioritizeResult;
  issues: PrioritizeIssue[];
}

export interface PrioritizeVerifyResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: PrioritizeIssue[];
}

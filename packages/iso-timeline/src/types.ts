export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface TimelineConfig {
  version: 1;
  defaults?: TimelineDefaults;
  rules: TimelineRule[];
}

export interface TimelineDefaults {
  now?: string;
  latestOnly?: boolean;
  overdueAfter?: DurationInput;
}

export interface TimelineRule {
  id: string;
  label?: string;
  description?: string;
  action: string;
  match?: TimelineMatcher;
  after?: DurationInput;
  overdueAfter?: DurationInput;
  latestOnly?: boolean;
  suppressWhen?: TimelineMatcher[];
  blockWhen?: TimelineMatcher[];
  meta?: JsonObject;
}

export interface TimelineMatcher {
  type?: string | string[];
  key?: string | string[];
  where?: Record<string, JsonPrimitive | JsonPrimitive[]>;
}

export type DurationInput = string | DurationObject;

export interface DurationObject {
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export interface TimelineEvent {
  id?: string;
  key: string;
  type: string;
  at: string;
  data?: JsonObject;
  source?: TimelineSource;
}

export interface TimelineSource {
  path?: string;
  line?: number;
}

export type TimelineItemState = "upcoming" | "due" | "overdue" | "suppressed" | "blocked";

export interface TimelineItem {
  id: string;
  rule: string;
  label: string;
  action: string;
  key: string;
  state: TimelineItemState;
  event: TimelineEvent;
  dueAt: string;
  overdueAt?: string;
  reasons: string[];
  suppressedBy?: TimelineEvent[];
  blockedBy?: TimelineEvent[];
  meta?: JsonObject;
}

export interface TimelineStats {
  total: number;
  upcoming: number;
  due: number;
  overdue: number;
  suppressed: number;
  blocked: number;
}

export type IssueSeverity = "error" | "warn";

export interface TimelineIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  rule?: string;
  item?: string;
  path?: string;
}

export interface TimelineResult {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  now: string;
  configHash: string;
  items: TimelineItem[];
  stats: TimelineStats;
  issues: TimelineIssue[];
}

export interface TimelinePlanOptions {
  now?: string | Date;
}

export interface TimelineCheckOptions extends TimelinePlanOptions {
  failOn?: TimelineItemState | TimelineItemState[] | "none";
}

export interface TimelineCheckResult {
  ok: boolean;
  errors: number;
  warnings: number;
  failOn: TimelineItemState[];
  result: TimelineResult;
  issues: TimelineIssue[];
}

export interface TimelineVerifyResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: TimelineIssue[];
}

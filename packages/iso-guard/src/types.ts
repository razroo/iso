export type Severity = "error" | "warn";

export interface GuardEvent {
  type: string;
  name?: string;
  at?: string;
  text?: string;
  group?: string | number;
  index?: number;
  source?: string;
  data?: Record<string, unknown>;
}

export type SelectorValue = string | number | boolean | Array<string | number | boolean>;

export interface EventSelector {
  type?: string | string[];
  name?: string | string[];
  text?: string;
  fields?: Record<string, SelectorValue>;
}

export interface BaseRule {
  id: string;
  type: string;
  severity?: Severity;
  description?: string;
}

export interface MaxPerGroupRule extends BaseRule {
  type: "max-per-group";
  match: EventSelector;
  groupBy?: string;
  max: number;
}

export interface RequireBeforeRule extends BaseRule {
  type: "require-before";
  trigger: EventSelector;
  require: EventSelector;
  groupBy?: string;
}

export interface RequireAfterRule extends BaseRule {
  type: "require-after";
  ifAny: EventSelector;
  require: EventSelector[];
}

export type RegexSpec = string | { source: string; flags?: string };

export interface ForbidTextRule extends BaseRule {
  type: "forbid-text";
  match?: EventSelector;
  patterns: RegexSpec[];
}

export interface NoOverlapRule extends BaseRule {
  type: "no-overlap";
  start: EventSelector;
  end: EventSelector;
  keyBy: string;
  requireClosed?: boolean;
}

export type GuardRule =
  | MaxPerGroupRule
  | RequireBeforeRule
  | RequireAfterRule
  | ForbidTextRule
  | NoOverlapRule;

export interface GuardPolicy {
  version: 1;
  sourcePath?: string;
  rules: GuardRule[];
}

export interface Violation {
  ruleId: string;
  severity: Severity;
  message: string;
  eventIndex?: number;
  eventIndexes?: number[];
  details?: Record<string, unknown>;
}

export interface AuditResult {
  ok: boolean;
  ruleCount: number;
  eventCount: number;
  errors: number;
  warnings: number;
  violations: Violation[];
}

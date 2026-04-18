export type Scope = "hard" | "default";

export interface Rule {
  id: string;
  scope: Scope;
  claim: string;
  why: string | null;
  line: number;
}

export interface ProcedureStep {
  index: number;
  text: string;
  line: number;
}

export interface RoutingRow {
  when: string;
  then: string;
  line: number;
}

export interface Doc {
  agent: string;
  description: string;
  hardLimits: Rule[];
  defaults: Rule[];
  procedure: ProcedureStep[];
  routing: RoutingRow[];
  context: { heading: string; body: string }[];
  sourcePath?: string;
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  line?: number;
}

export type Backend = "api" | "claude-code" | "fake";

export interface RunMeta {
  via: Backend;
  model: string | null;
  judgeModel: string | null;
  temperature: number | null;
  timestamp: string;
}

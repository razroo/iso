export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface PreflightConfig {
  version: 1;
  workflows: PreflightWorkflow[];
}

export interface PreflightWorkflow {
  name: string;
  description?: string;
  roundSize: number;
  idFact?: string;
  conflictFact?: string;
  requiredFacts: string[];
  sourceRequiredFacts?: string[];
  requireGateSources?: boolean;
  gatePolicy?: PreflightGatePolicy;
  preSteps?: PreflightStep[];
  postSteps?: PreflightStep[];
}

export interface PreflightGatePolicy {
  skipStatuses?: string[];
  blockStatuses?: string[];
}

export interface PreflightStep {
  id: string;
  label: string;
  command?: string;
}

export interface PreflightCandidateSet {
  candidates: PreflightCandidateInput[];
}

export interface PreflightCandidateInput {
  id?: string;
  facts?: Record<string, PreflightFactInput>;
  gates?: PreflightGateInput[];
  meta?: JsonObject;
}

export type PreflightFactInput = JsonValue | PreflightFact;

export interface PreflightFact {
  value: JsonValue;
  source?: string;
}

export interface PreflightGateInput {
  id: string;
  status: string;
  reason?: string;
  source?: string;
  data?: JsonObject;
}

export interface PlanPreflightOptions {
  workflow?: string;
}

export interface PreflightPlanResult {
  workflow: PreflightWorkflow;
  ok: boolean;
  totals: PreflightTotals;
  preSteps: PreflightStep[];
  postSteps: PreflightStep[];
  ready: PreflightCandidatePlan[];
  skipped: PreflightCandidatePlan[];
  blocked: PreflightCandidatePlan[];
  rounds: PreflightRound[];
}

export interface PreflightTotals {
  candidates: number;
  ready: number;
  skipped: number;
  blocked: number;
  rounds: number;
}

export type PreflightCandidateState = "ready" | "skipped" | "blocked";

export interface PreflightCandidatePlan {
  id: string;
  state: PreflightCandidateState;
  facts: Record<string, PreflightFact>;
  gates: PreflightGateInput[];
  issues: PreflightIssue[];
  conflictKey?: string;
}

export interface PreflightIssue {
  kind: "missing-fact" | "missing-source" | "gate-skip" | "gate-block";
  message: string;
  fact?: string;
  gate?: string;
  source?: string;
}

export interface PreflightRound {
  index: number;
  candidates: PreflightCandidatePlan[];
}

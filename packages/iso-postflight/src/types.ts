export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface PostflightConfig {
  version: 1;
  workflows: PostflightWorkflow[];
}

export interface PostflightWorkflow {
  name: string;
  description?: string;
  terminalStatuses: string[];
  successStatuses: string[];
  failureStatuses: string[];
  skipStatuses: string[];
  inFlightStatuses: string[];
  replacementStatuses: string[];
  requiredArtifacts: PostflightRequiredArtifact[];
  postSteps: PostflightStep[];
}

export interface PostflightRequiredArtifact {
  id: string;
  label?: string;
  statuses?: string[];
}

export interface PostflightStep {
  id: string;
  label: string;
  command?: string;
}

export interface PostflightPlan {
  workflow?: string;
  rounds: PostflightPlanRound[];
  postSteps: PostflightStep[];
}

export interface PostflightPlanRound {
  index: number;
  candidates: PostflightPlanCandidate[];
}

export interface PostflightPlanCandidate {
  id: string;
}

export interface PostflightObservations {
  dispatches: PostflightDispatch[];
  outcomes: PostflightOutcome[];
  steps: PostflightStepObservation[];
}

export interface PostflightDispatch {
  candidateId: string;
  status?: string;
  source?: string;
}

export interface PostflightOutcome {
  candidateId: string;
  status: string;
  source?: string;
  artifacts: PostflightArtifact[];
  data?: JsonObject;
}

export interface PostflightArtifact {
  id: string;
  status: string;
  source?: string;
}

export interface PostflightStepObservation {
  id: string;
  status: string;
  source?: string;
}

export interface SettlePostflightOptions {
  workflow?: string;
}

export type PostflightCandidateState =
  | "not-started"
  | "in-flight"
  | "missing-output"
  | "blocked"
  | "replacement"
  | "succeeded"
  | "failed"
  | "skipped"
  | "settled";

export type PostflightRoundState =
  | "not-started"
  | "in-flight"
  | "missing-output"
  | "blocked"
  | "needs-replacement"
  | "complete";

export type PostflightWorkflowState =
  | "complete"
  | "ready-for-next-round"
  | "needs-post-step"
  | "in-flight"
  | "missing-output"
  | "needs-replacement"
  | "blocked";

export type PostflightNextActionKind =
  | "complete"
  | "dispatch-round"
  | "run-post-step"
  | "wait"
  | "collect-output"
  | "replace-candidates"
  | "stop";

export interface PostflightNextAction {
  kind: PostflightNextActionKind;
  message: string;
  round?: number;
  candidates?: string[];
  step?: PostflightStep;
}

export interface PostflightResult {
  workflow: PostflightWorkflow;
  ok: boolean;
  state: PostflightWorkflowState;
  nextAction: PostflightNextAction;
  totals: PostflightTotals;
  rounds: PostflightRoundResult[];
  postSteps: PostflightStepResult[];
  issues: PostflightIssue[];
}

export interface PostflightTotals {
  rounds: number;
  candidates: number;
  completeRounds: number;
  notStartedRounds: number;
  succeeded: number;
  failed: number;
  skipped: number;
  replacement: number;
  inFlight: number;
  missing: number;
  blocked: number;
}

export interface PostflightRoundResult {
  index: number;
  state: PostflightRoundState;
  candidates: PostflightCandidateResult[];
}

export interface PostflightCandidateResult {
  id: string;
  state: PostflightCandidateState;
  status?: string;
  outcome?: PostflightOutcome;
  dispatched: boolean;
  issues: PostflightIssue[];
}

export type PostflightStepState = "pass" | "fail" | "pending";

export interface PostflightStepResult {
  id: string;
  label: string;
  command?: string;
  state: PostflightStepState;
  status?: string;
  source?: string;
}

export interface PostflightIssue {
  kind:
    | "missing-outcome"
    | "unknown-status"
    | "missing-artifact"
    | "artifact-failed"
    | "step-failed";
  message: string;
  candidateId?: string;
  round?: number;
  artifact?: string;
  step?: string;
  source?: string;
}

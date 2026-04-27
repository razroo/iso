import { isJsonObject, isJsonValue } from "./json.js";
import type {
  JsonObject,
  JsonValue,
  PostflightArtifact,
  PostflightCandidateResult,
  PostflightConfig,
  PostflightDispatch,
  PostflightIssue,
  PostflightNextAction,
  PostflightObservations,
  PostflightOutcome,
  PostflightPlan,
  PostflightPlanCandidate,
  PostflightPlanRound,
  PostflightRequiredArtifact,
  PostflightResult,
  PostflightRoundResult,
  PostflightStep,
  PostflightStepObservation,
  PostflightStepResult,
  PostflightWorkflow,
  SettlePostflightOptions,
} from "./types.js";

const DEFAULT_SUCCESS_STATUSES = ["success", "succeeded", "completed", "done", "applied"];
const DEFAULT_FAILURE_STATUSES = ["fail", "failed", "error"];
const DEFAULT_SKIP_STATUSES = ["skip", "skipped", "discarded"];
const DEFAULT_IN_FLIGHT_STATUSES = ["running", "in-flight", "in flight", "started", "pending"];
const PASS_STATUSES = new Set(["pass", "passed", "present", "ok", "done", "complete", "completed", "success", "succeeded", "written", "exists"]);
const FAIL_STATUSES = new Set(["fail", "failed", "error", "blocked", "missing"]);

export function loadPostflightConfig(input: unknown): PostflightConfig {
  if (!isJsonObject(input)) throw new Error("postflight config must be an object");
  if (input.version !== 1) throw new Error("postflight config version must be 1");
  if (!Array.isArray(input.workflows)) throw new Error("postflight config workflows must be an array");
  return {
    version: 1,
    workflows: input.workflows.map((workflow, index) => normalizeWorkflow(workflow, `workflows[${index}]`)),
  };
}

export function loadPostflightPlan(input: unknown): PostflightPlan {
  if (!isJsonObject(input)) throw new Error("postflight plan must be an object");
  const workflow = normalizeWorkflowName(input.workflow, "plan.workflow");
  if (!Array.isArray(input.rounds)) throw new Error("postflight plan rounds must be an array");
  return {
    workflow,
    rounds: input.rounds.map((round, index) => normalizePlanRound(round, index)),
    postSteps: optionalSteps(input.postSteps, "plan.postSteps") ?? [],
  };
}

export function loadPostflightObservations(input: unknown): PostflightObservations {
  if (!isJsonObject(input)) throw new Error("postflight observations must be an object");
  return {
    dispatches: optionalDispatches(input.dispatches, "observations.dispatches") ?? [],
    outcomes: optionalOutcomes(input.outcomes, "observations.outcomes") ?? [],
    steps: optionalStepObservations(input.steps, "observations.steps") ?? [],
  };
}

export function settlePostflight(
  configInput: PostflightConfig | unknown,
  planInput: PostflightPlan | unknown,
  observationsInput: PostflightObservations | unknown,
  options: SettlePostflightOptions = {},
): PostflightResult {
  const config = loadPostflightConfig(configInput);
  const plan = loadPostflightPlan(planInput);
  const observations = loadPostflightObservations(observationsInput);
  const workflow = selectWorkflow(config, options.workflow || plan.workflow);
  const outcomeMap = new Map(observations.outcomes.map((outcome) => [outcome.candidateId, outcome]));
  const dispatchSet = new Set([
    ...observations.dispatches.map((dispatch) => dispatch.candidateId),
    ...observations.outcomes.map((outcome) => outcome.candidateId),
  ]);
  const rounds = plan.rounds.map((round) => settleRound(workflow, round, outcomeMap, dispatchSet));
  const postSteps = settlePostSteps(plan.postSteps.length ? plan.postSteps : workflow.postSteps, observations.steps);
  const issues = [
    ...rounds.flatMap((round) => round.candidates.flatMap((candidate) => candidate.issues)),
    ...postSteps
      .filter((step) => step.state === "fail")
      .map((step): PostflightIssue => ({
        kind: "step-failed",
        step: step.id,
        source: step.source,
        message: `post step "${step.id}" failed`,
      })),
  ];
  const totals = computeTotals(rounds);
  const { state, nextAction } = decideNext(rounds, postSteps);

  return {
    workflow,
    ok: state === "complete",
    state,
    nextAction,
    totals,
    rounds,
    postSteps,
    issues,
  };
}

function normalizeWorkflow(input: unknown, label: string): PostflightWorkflow {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  const successStatuses = optionalStringArray(input.successStatuses, `${label}.successStatuses`) ?? DEFAULT_SUCCESS_STATUSES;
  const failureStatuses = optionalStringArray(input.failureStatuses, `${label}.failureStatuses`) ?? DEFAULT_FAILURE_STATUSES;
  const skipStatuses = optionalStringArray(input.skipStatuses, `${label}.skipStatuses`) ?? DEFAULT_SKIP_STATUSES;
  const terminalStatuses = optionalStringArray(input.terminalStatuses, `${label}.terminalStatuses`) ?? [
    ...successStatuses,
    ...failureStatuses,
    ...skipStatuses,
  ];
  return {
    name: requireString(input.name, `${label}.name`),
    description: optionalString(input.description, `${label}.description`),
    terminalStatuses,
    successStatuses,
    failureStatuses,
    skipStatuses,
    inFlightStatuses: optionalStringArray(input.inFlightStatuses, `${label}.inFlightStatuses`) ?? DEFAULT_IN_FLIGHT_STATUSES,
    replacementStatuses: optionalStringArray(input.replacementStatuses, `${label}.replacementStatuses`) ?? [],
    requiredArtifacts: optionalRequiredArtifacts(input.requiredArtifacts, `${label}.requiredArtifacts`) ?? [],
    postSteps: optionalSteps(input.postSteps, `${label}.postSteps`) ?? [],
  };
}

function normalizeWorkflowName(input: unknown, label: string): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "string") return input;
  if (isJsonObject(input)) return optionalString(input.name, `${label}.name`);
  throw new Error(`${label} must be a string or object`);
}

function normalizePlanRound(input: unknown, index: number): PostflightPlanRound {
  if (!isJsonObject(input)) throw new Error(`rounds[${index}] must be an object`);
  if (!Array.isArray(input.candidates)) throw new Error(`rounds[${index}].candidates must be an array`);
  return {
    index: input.index === undefined ? index + 1 : requirePositiveInteger(input.index, `rounds[${index}].index`),
    candidates: input.candidates.map((candidate, candidateIndex) => normalizePlanCandidate(candidate, `rounds[${index}].candidates[${candidateIndex}]`)),
  };
}

function normalizePlanCandidate(input: unknown, label: string): PostflightPlanCandidate {
  if (typeof input === "string" && input.trim()) return { id: input };
  if (!isJsonObject(input)) throw new Error(`${label} must be a string or object`);
  return { id: requireString(input.id, `${label}.id`) };
}

function optionalDispatches(input: unknown, label: string): PostflightDispatch[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((dispatch, index) => normalizeDispatch(dispatch, `${label}[${index}]`));
}

function normalizeDispatch(input: unknown, label: string): PostflightDispatch {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    candidateId: requireCandidateId(input, label),
    status: optionalString(input.status, `${label}.status`),
    source: optionalString(input.source, `${label}.source`),
  };
}

function optionalOutcomes(input: unknown, label: string): PostflightOutcome[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((outcome, index) => normalizeOutcome(outcome, `${label}[${index}]`));
}

function normalizeOutcome(input: unknown, label: string): PostflightOutcome {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    candidateId: requireCandidateId(input, label),
    status: requireString(input.status, `${label}.status`),
    source: optionalString(input.source, `${label}.source`),
    artifacts: normalizeArtifacts(input.artifacts, `${label}.artifacts`),
    data: normalizeMeta(input.data, `${label}.data`),
  };
}

function normalizeArtifacts(input: unknown, label: string): PostflightArtifact[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input.map((artifact, index) => normalizeArtifact(artifact, `${label}[${index}]`));
  if (!isJsonObject(input)) throw new Error(`${label} must be an array or object`);
  return Object.entries(input).map(([id, artifact]) => {
    if (typeof artifact === "string") return { id, status: "present", source: artifact };
    if (!isJsonObject(artifact)) throw new Error(`${label}.${id} must be a string or object`);
    return {
      id,
      status: optionalString(artifact.status, `${label}.${id}.status`) ?? "present",
      source: optionalString(artifact.source, `${label}.${id}.source`),
    };
  });
}

function normalizeArtifact(input: unknown, label: string): PostflightArtifact {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    status: optionalString(input.status, `${label}.status`) ?? "present",
    source: optionalString(input.source, `${label}.source`),
  };
}

function optionalStepObservations(input: unknown, label: string): PostflightStepObservation[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((step, index) => normalizeStepObservation(step, `${label}[${index}]`));
}

function normalizeStepObservation(input: unknown, label: string): PostflightStepObservation {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    status: requireString(input.status, `${label}.status`),
    source: optionalString(input.source, `${label}.source`),
  };
}

function optionalRequiredArtifacts(input: unknown, label: string): PostflightRequiredArtifact[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((artifact, index) => normalizeRequiredArtifact(artifact, `${label}[${index}]`));
}

function normalizeRequiredArtifact(input: unknown, label: string): PostflightRequiredArtifact {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    label: optionalString(input.label, `${label}.label`),
    statuses: optionalStringArray(input.statuses, `${label}.statuses`),
  };
}

function optionalSteps(input: unknown, label: string): PostflightStep[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((step, index) => normalizeStep(step, `${label}[${index}]`));
}

function normalizeStep(input: unknown, label: string): PostflightStep {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    label: requireString(input.label, `${label}.label`),
    command: optionalString(input.command, `${label}.command`),
  };
}

function settleRound(
  workflow: PostflightWorkflow,
  round: PostflightPlanRound,
  outcomeMap: Map<string, PostflightOutcome>,
  dispatchSet: Set<string>,
): PostflightRoundResult {
  const candidates = round.candidates.map((candidate) => settleCandidate(workflow, round.index, candidate, outcomeMap.get(candidate.id), dispatchSet.has(candidate.id)));
  const state = candidates.every((candidate) => candidate.state === "not-started")
    ? "not-started"
    : candidates.some((candidate) => candidate.state === "in-flight")
      ? "in-flight"
      : candidates.some((candidate) => candidate.state === "missing-output")
        ? "missing-output"
        : candidates.some((candidate) => candidate.state === "blocked")
          ? "blocked"
          : candidates.some((candidate) => candidate.state === "replacement")
            ? "needs-replacement"
            : "complete";
  return { index: round.index, state, candidates };
}

function settleCandidate(
  workflow: PostflightWorkflow,
  round: number,
  candidate: PostflightPlanCandidate,
  outcome: PostflightOutcome | undefined,
  dispatched: boolean,
): PostflightCandidateResult {
  if (!outcome) {
    const issues = dispatched
      ? [{
        kind: "missing-outcome" as const,
        candidateId: candidate.id,
        round,
        message: `candidate "${candidate.id}" was dispatched but has no outcome`,
      }]
      : [];
    return {
      id: candidate.id,
      state: dispatched ? "missing-output" : "not-started",
      dispatched,
      issues,
    };
  }

  const status = normalizeStatus(outcome.status);
  if (statusSet(workflow.inFlightStatuses).has(status)) {
    return { id: candidate.id, state: "in-flight", status: outcome.status, outcome, dispatched, issues: [] };
  }

  const terminalStatuses = statusSet(workflow.terminalStatuses);
  if (!terminalStatuses.has(status)) {
    return {
      id: candidate.id,
      state: "blocked",
      status: outcome.status,
      outcome,
      dispatched,
      issues: [{
        kind: "unknown-status",
        candidateId: candidate.id,
        round,
        source: outcome.source,
        message: `candidate "${candidate.id}" outcome status "${outcome.status}" is not terminal`,
      }],
    };
  }

  const artifactIssues = requiredArtifactIssues(workflow, round, candidate.id, outcome);
  if (artifactIssues.length) {
    return { id: candidate.id, state: "blocked", status: outcome.status, outcome, dispatched, issues: artifactIssues };
  }

  if (statusSet(workflow.replacementStatuses).has(status)) {
    return { id: candidate.id, state: "replacement", status: outcome.status, outcome, dispatched, issues: [] };
  }
  if (statusSet(workflow.failureStatuses).has(status)) {
    return { id: candidate.id, state: "failed", status: outcome.status, outcome, dispatched, issues: [] };
  }
  if (statusSet(workflow.skipStatuses).has(status)) {
    return { id: candidate.id, state: "skipped", status: outcome.status, outcome, dispatched, issues: [] };
  }
  if (statusSet(workflow.successStatuses).has(status)) {
    return { id: candidate.id, state: "succeeded", status: outcome.status, outcome, dispatched, issues: [] };
  }
  return { id: candidate.id, state: "settled", status: outcome.status, outcome, dispatched, issues: [] };
}

function requiredArtifactIssues(
  workflow: PostflightWorkflow,
  round: number,
  candidateId: string,
  outcome: PostflightOutcome,
): PostflightIssue[] {
  const status = normalizeStatus(outcome.status);
  const artifacts = new Map(outcome.artifacts.map((artifact) => [artifact.id, artifact]));
  const issues: PostflightIssue[] = [];
  for (const required of workflow.requiredArtifacts) {
    if (required.statuses && !statusSet(required.statuses).has(status)) continue;
    const artifact = artifacts.get(required.id);
    if (!artifact) {
      issues.push({
        kind: "missing-artifact",
        candidateId,
        round,
        artifact: required.id,
        source: outcome.source,
        message: `candidate "${candidateId}" is missing required artifact "${required.id}"`,
      });
    } else if (!PASS_STATUSES.has(normalizeStatus(artifact.status))) {
      issues.push({
        kind: "artifact-failed",
        candidateId,
        round,
        artifact: required.id,
        source: artifact.source,
        message: `candidate "${candidateId}" artifact "${required.id}" status "${artifact.status}" is not passing`,
      });
    }
  }
  return issues;
}

function settlePostSteps(steps: PostflightStep[], observations: PostflightStepObservation[]): PostflightStepResult[] {
  const observed = new Map(observations.map((observation) => [observation.id, observation]));
  return steps.map((step) => {
    const observation = observed.get(step.id);
    if (!observation) return { ...step, state: "pending" };
    const status = normalizeStatus(observation.status);
    const state = PASS_STATUSES.has(status)
      ? "pass"
      : FAIL_STATUSES.has(status)
        ? "fail"
        : "pending";
    return {
      ...step,
      state,
      status: observation.status,
      source: observation.source,
    };
  });
}

function decideNext(rounds: PostflightRoundResult[], postSteps: PostflightStepResult[]): { state: PostflightResult["state"]; nextAction: PostflightNextAction } {
  for (const round of rounds) {
    if (round.state === "complete") continue;
    if (round.state === "not-started") {
      return {
        state: "ready-for-next-round",
        nextAction: {
          kind: "dispatch-round",
          round: round.index,
          candidates: round.candidates.map((candidate) => candidate.id),
          message: `Dispatch round ${round.index}.`,
        },
      };
    }
    if (round.state === "in-flight") {
      return {
        state: "in-flight",
        nextAction: {
          kind: "wait",
          round: round.index,
          candidates: round.candidates.filter((candidate) => candidate.state === "in-flight").map((candidate) => candidate.id),
          message: `Wait for round ${round.index} to finish.`,
        },
      };
    }
    if (round.state === "missing-output") {
      return {
        state: "missing-output",
        nextAction: {
          kind: "collect-output",
          round: round.index,
          candidates: round.candidates.filter((candidate) => candidate.state === "missing-output").map((candidate) => candidate.id),
          message: `Collect missing outcomes for round ${round.index}.`,
        },
      };
    }
    if (round.state === "needs-replacement") {
      return {
        state: "needs-replacement",
        nextAction: {
          kind: "replace-candidates",
          round: round.index,
          candidates: round.candidates.filter((candidate) => candidate.state === "replacement").map((candidate) => candidate.id),
          message: `Select replacement candidates for round ${round.index}.`,
        },
      };
    }
    return {
      state: "blocked",
      nextAction: {
        kind: "stop",
        round: round.index,
        candidates: round.candidates.filter((candidate) => candidate.state === "blocked").map((candidate) => candidate.id),
        message: `Resolve blocked round ${round.index}.`,
      },
    };
  }

  const failedStep = postSteps.find((step) => step.state === "fail");
  if (failedStep) {
    return {
      state: "blocked",
      nextAction: {
        kind: "stop",
        step: failedStep,
        message: `Resolve failed post step "${failedStep.id}".`,
      },
    };
  }

  const pendingStep = postSteps.find((step) => step.state === "pending");
  if (pendingStep) {
    return {
      state: "needs-post-step",
      nextAction: {
        kind: "run-post-step",
        step: pendingStep,
        message: `Run post step "${pendingStep.id}".`,
      },
    };
  }

  return {
    state: "complete",
    nextAction: { kind: "complete", message: "Workflow is complete." },
  };
}

function computeTotals(rounds: PostflightRoundResult[]) {
  const candidates = rounds.flatMap((round) => round.candidates);
  return {
    rounds: rounds.length,
    candidates: candidates.length,
    completeRounds: rounds.filter((round) => round.state === "complete").length,
    notStartedRounds: rounds.filter((round) => round.state === "not-started").length,
    succeeded: candidates.filter((candidate) => candidate.state === "succeeded").length,
    failed: candidates.filter((candidate) => candidate.state === "failed").length,
    skipped: candidates.filter((candidate) => candidate.state === "skipped").length,
    replacement: candidates.filter((candidate) => candidate.state === "replacement").length,
    inFlight: candidates.filter((candidate) => candidate.state === "in-flight").length,
    missing: candidates.filter((candidate) => candidate.state === "missing-output").length,
    blocked: candidates.filter((candidate) => candidate.state === "blocked").length,
  };
}

function selectWorkflow(config: PostflightConfig, name?: string): PostflightWorkflow {
  if (!config.workflows.length) throw new Error("postflight config must define at least one workflow");
  if (!name) {
    if (config.workflows.length > 1) throw new Error("--workflow is required when config has multiple workflows");
    return config.workflows[0]!;
  }
  const workflow = config.workflows.find((item) => item.name === name);
  if (!workflow) throw new Error(`workflow not found: ${name}`);
  return workflow;
}

function normalizeMeta(input: unknown, label: string): JsonObject | undefined {
  if (input === undefined) return undefined;
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  if (!isJsonValue(input)) throw new Error(`${label} must be JSON`);
  return input;
}

function requireCandidateId(input: JsonObject, label: string): string {
  const candidateId = input.candidateId ?? input.id;
  return requireString(candidateId, `${label}.candidateId`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase();
}

function statusSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeStatus));
}

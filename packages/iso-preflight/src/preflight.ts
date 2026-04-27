import { isJsonObject, isJsonValue } from "./json.js";
import type {
  JsonObject,
  JsonValue,
  PlanPreflightOptions,
  PreflightCandidateInput,
  PreflightCandidatePlan,
  PreflightCandidateSet,
  PreflightConfig,
  PreflightFact,
  PreflightFactInput,
  PreflightGateInput,
  PreflightGatePolicy,
  PreflightIssue,
  PreflightPlanResult,
  PreflightRound,
  PreflightStep,
  PreflightWorkflow,
} from "./types.js";

const DEFAULT_SKIP_STATUSES = ["skip", "skipped"];
const DEFAULT_BLOCK_STATUSES = ["block", "blocked", "fail", "failed"];

export function loadPreflightConfig(input: unknown): PreflightConfig {
  if (!isJsonObject(input)) throw new Error("preflight config must be an object");
  if (input.version !== 1) throw new Error("preflight config version must be 1");
  if (!Array.isArray(input.workflows)) throw new Error("preflight config workflows must be an array");
  return {
    version: 1,
    workflows: input.workflows.map((workflow, index) => normalizeWorkflow(workflow, `workflows[${index}]`)),
  };
}

export function loadCandidateSet(input: unknown): PreflightCandidateSet {
  if (Array.isArray(input)) {
    return { candidates: input.map((candidate, index) => normalizeCandidateInput(candidate, `candidates[${index}]`)) };
  }
  if (!isJsonObject(input)) throw new Error("candidate input must be an object or array");
  if (!Array.isArray(input.candidates)) throw new Error("candidate input candidates must be an array");
  return {
    candidates: input.candidates.map((candidate, index) => normalizeCandidateInput(candidate, `candidates[${index}]`)),
  };
}

export function planPreflight(
  configInput: PreflightConfig | unknown,
  candidateInput: PreflightCandidateSet | PreflightCandidateInput[] | unknown,
  options: PlanPreflightOptions = {},
): PreflightPlanResult {
  const config = loadPreflightConfig(configInput);
  const workflow = selectWorkflow(config, options.workflow);
  const candidateSet = loadCandidateSet(candidateInput);
  const planned = candidateSet.candidates.map((candidate, index) => planCandidate(workflow, candidate, index));
  const blocked = planned.filter((candidate) => candidate.state === "blocked");
  const skipped = planned.filter((candidate) => candidate.state === "skipped");
  const ready = planned.filter((candidate) => candidate.state === "ready");
  const rounds = buildRounds(workflow, ready);

  return {
    workflow,
    ok: blocked.length === 0,
    totals: {
      candidates: planned.length,
      ready: ready.length,
      skipped: skipped.length,
      blocked: blocked.length,
      rounds: rounds.length,
    },
    preSteps: workflow.preSteps ?? [],
    postSteps: workflow.postSteps ?? [],
    ready,
    skipped,
    blocked,
    rounds,
  };
}

function normalizeWorkflow(input: unknown, label: string): PreflightWorkflow {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  const name = requireString(input.name, `${label}.name`);
  const roundSize = input.roundSize === undefined ? 1 : requirePositiveInteger(input.roundSize, `${label}.roundSize`);
  const requiredFacts = optionalStringArray(input.requiredFacts, `${label}.requiredFacts`) ?? [];
  return {
    name,
    description: optionalString(input.description, `${label}.description`),
    roundSize,
    idFact: optionalString(input.idFact, `${label}.idFact`),
    conflictFact: optionalString(input.conflictFact, `${label}.conflictFact`),
    requiredFacts,
    sourceRequiredFacts: optionalStringArray(input.sourceRequiredFacts, `${label}.sourceRequiredFacts`),
    requireGateSources: optionalBoolean(input.requireGateSources, `${label}.requireGateSources`),
    gatePolicy: normalizeGatePolicy(input.gatePolicy, `${label}.gatePolicy`),
    preSteps: optionalSteps(input.preSteps, `${label}.preSteps`),
    postSteps: optionalSteps(input.postSteps, `${label}.postSteps`),
  };
}

function normalizeCandidateInput(input: unknown, label: string): PreflightCandidateInput {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: optionalString(input.id, `${label}.id`),
    facts: normalizeFacts(input.facts, `${label}.facts`),
    gates: normalizeGates(input.gates, `${label}.gates`),
    meta: normalizeMeta(input.meta, `${label}.meta`),
  };
}

function normalizeFacts(input: unknown, label: string): Record<string, PreflightFactInput> | undefined {
  if (input === undefined) return undefined;
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  const facts: Record<string, PreflightFactInput> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isJsonValue(value)) throw new Error(`${label}.${key} must be JSON`);
    facts[key] = value;
  }
  return facts;
}

function normalizeGates(input: unknown, label: string): PreflightGateInput[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((gate, index) => normalizeGate(gate, `${label}[${index}]`));
}

function normalizeGate(input: unknown, label: string): PreflightGateInput {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    status: requireString(input.status, `${label}.status`),
    reason: optionalString(input.reason, `${label}.reason`),
    source: optionalString(input.source, `${label}.source`),
    data: normalizeMeta(input.data, `${label}.data`),
  };
}

function normalizeGatePolicy(input: unknown, label: string): PreflightGatePolicy | undefined {
  if (input === undefined) return undefined;
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    skipStatuses: optionalStringArray(input.skipStatuses, `${label}.skipStatuses`),
    blockStatuses: optionalStringArray(input.blockStatuses, `${label}.blockStatuses`),
  };
}

function optionalSteps(input: unknown, label: string): PreflightStep[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((step, index) => normalizeStep(step, `${label}[${index}]`));
}

function normalizeStep(input: unknown, label: string): PreflightStep {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  return {
    id: requireString(input.id, `${label}.id`),
    label: requireString(input.label, `${label}.label`),
    command: optionalString(input.command, `${label}.command`),
  };
}

function normalizeMeta(input: unknown, label: string): JsonObject | undefined {
  if (input === undefined) return undefined;
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  if (!isJsonValue(input)) throw new Error(`${label} must be JSON`);
  return input;
}

function selectWorkflow(config: PreflightConfig, name?: string): PreflightWorkflow {
  if (!config.workflows.length) throw new Error("preflight config must define at least one workflow");
  if (!name) {
    if (config.workflows.length > 1) throw new Error("--workflow is required when config has multiple workflows");
    return config.workflows[0]!;
  }
  const workflow = config.workflows.find((item) => item.name === name);
  if (!workflow) throw new Error(`workflow not found: ${name}`);
  return workflow;
}

function planCandidate(workflow: PreflightWorkflow, candidate: PreflightCandidateInput, index: number): PreflightCandidatePlan {
  const facts = normalizeCandidateFacts(candidate.facts ?? {});
  const gates = candidate.gates ?? [];
  const id = candidate.id || factString(facts[workflow.idFact || "id"]) || `candidate-${index + 1}`;
  const issues: PreflightIssue[] = [];

  for (const fact of workflow.requiredFacts) {
    if (!hasFactValue(facts[fact])) {
      issues.push({
        kind: "missing-fact",
        fact,
        message: `required fact "${fact}" is missing`,
      });
    }
  }

  for (const fact of workflow.sourceRequiredFacts ?? []) {
    if (!hasFactValue(facts[fact])) {
      issues.push({
        kind: "missing-fact",
        fact,
        message: `source-required fact "${fact}" is missing`,
      });
    } else if (!facts[fact]?.source) {
      issues.push({
        kind: "missing-source",
        fact,
        message: `fact "${fact}" must include a source`,
      });
    }
  }

  if (workflow.requireGateSources) {
    for (const gate of gates) {
      if (!gate.source) {
        issues.push({
          kind: "missing-source",
          gate: gate.id,
          message: `gate "${gate.id}" must include a source`,
        });
      }
    }
  }

  const skipStatuses = statusSet(workflow.gatePolicy?.skipStatuses ?? DEFAULT_SKIP_STATUSES);
  const blockStatuses = statusSet(workflow.gatePolicy?.blockStatuses ?? DEFAULT_BLOCK_STATUSES);
  for (const gate of gates) {
    const status = normalizeStatus(gate.status);
    if (blockStatuses.has(status)) {
      issues.push({
        kind: "gate-block",
        gate: gate.id,
        source: gate.source,
        message: gate.reason || `gate "${gate.id}" blocked candidate`,
      });
    } else if (skipStatuses.has(status)) {
      issues.push({
        kind: "gate-skip",
        gate: gate.id,
        source: gate.source,
        message: gate.reason || `gate "${gate.id}" skipped candidate`,
      });
    }
  }

  const state = issues.some((issue) => issue.kind === "missing-fact" || issue.kind === "missing-source" || issue.kind === "gate-block")
    ? "blocked"
    : issues.some((issue) => issue.kind === "gate-skip")
      ? "skipped"
      : "ready";

  return {
    id,
    state,
    facts,
    gates,
    issues,
    conflictKey: workflow.conflictFact ? factString(facts[workflow.conflictFact]) : undefined,
  };
}

function normalizeCandidateFacts(input: Record<string, PreflightFactInput>): Record<string, PreflightFact> {
  const facts: Record<string, PreflightFact> = {};
  for (const [key, value] of Object.entries(input)) facts[key] = normalizeFact(value);
  return facts;
}

function normalizeFact(input: PreflightFactInput): PreflightFact {
  if (isJsonObject(input) && ("value" in input || "source" in input)) {
    const value = input.value;
    if (!isJsonValue(value)) throw new Error("fact value must be JSON");
    const source = input.source;
    if (source !== undefined && typeof source !== "string") throw new Error("fact source must be a string");
    return { value, source };
  }
  return { value: input as JsonValue };
}

function buildRounds(workflow: PreflightWorkflow, candidates: PreflightCandidatePlan[]): PreflightRound[] {
  const rounds: PreflightRound[] = [];
  let current: PreflightCandidatePlan[] = [];
  let conflicts = new Set<string>();

  for (const candidate of candidates) {
    const conflict = candidate.conflictKey;
    const wouldExceedRoundSize = current.length >= workflow.roundSize;
    const wouldConflict = Boolean(conflict && conflicts.has(conflict));
    if (current.length > 0 && (wouldExceedRoundSize || wouldConflict)) {
      rounds.push({ index: rounds.length + 1, candidates: current });
      current = [];
      conflicts = new Set<string>();
    }
    current.push(candidate);
    if (conflict) conflicts.add(conflict);
  }

  if (current.length > 0) rounds.push({ index: rounds.length + 1, candidates: current });
  return rounds;
}

function hasFactValue(fact: PreflightFact | undefined): boolean {
  if (!fact) return false;
  if (fact.value === null || fact.value === undefined) return false;
  return String(fact.value).trim().length > 0;
}

function factString(fact: PreflightFact | undefined): string | undefined {
  if (!hasFactValue(fact)) return undefined;
  return String(fact?.value);
}

function statusSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeStatus));
}

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase();
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

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

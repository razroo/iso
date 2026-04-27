import { createHash } from "node:crypto";
import { isJsonObject, stableStringify, toJsonValue } from "./json.js";
import type {
  CheckScoreResult,
  ComputeScoreOptions,
  EvaluateGateOptions,
  EvaluateGateResult,
  JsonObject,
  ScoreBandConfig,
  ScoreBandResult,
  ScoreComparison,
  ScoreConfig,
  ScoreDimensionConfig,
  ScoreDimensionInput,
  ScoreDimensionResult,
  ScoreGateConfig,
  ScoreGateResult,
  ScoreInput,
  ScoreIssue,
  ScoreProfile,
  ScoreResult,
  ScoreScale,
  ScoreVerifyResult,
} from "./types.js";

const DEFAULT_SCALE: ScoreScale = { min: 0, max: 5, precision: 2 };

export function loadScoreConfig(input: unknown): ScoreConfig {
  const config = requireObject(input, "config") as unknown as ScoreConfig;
  if (config.version !== 1) throw new Error("config.version must be 1");
  if (!Array.isArray(config.profiles) || config.profiles.length === 0) {
    throw new Error("config.profiles must be a non-empty array");
  }

  const names = new Set<string>();
  for (let p = 0; p < config.profiles.length; p++) {
    const profile = requireObject(config.profiles[p], `profiles[${p}]`) as unknown as ScoreProfile;
    if (!isNonEmptyString(profile.name)) throw new Error(`profiles[${p}].name must be a non-empty string`);
    if (names.has(profile.name)) throw new Error(`duplicate profile name "${profile.name}"`);
    names.add(profile.name);
    const scale = normalizeScale(profile.scale, `profiles[${p}].scale`);
    if (!Array.isArray(profile.dimensions) || profile.dimensions.length === 0) {
      throw new Error(`profiles[${p}].dimensions must be a non-empty array`);
    }
    const dimensionIds = new Set<string>();
    for (let d = 0; d < profile.dimensions.length; d++) {
      const dimension = requireObject(profile.dimensions[d], `profiles[${p}].dimensions[${d}]`) as unknown as ScoreDimensionConfig;
      if (!isNonEmptyString(dimension.id)) {
        throw new Error(`profiles[${p}].dimensions[${d}].id must be a non-empty string`);
      }
      if (dimensionIds.has(dimension.id)) throw new Error(`duplicate dimension id "${dimension.id}" in profile "${profile.name}"`);
      dimensionIds.add(dimension.id);
      if (dimension.weight !== undefined && (!Number.isFinite(dimension.weight) || dimension.weight <= 0)) {
        throw new Error(`dimension "${dimension.id}" weight must be a positive number`);
      }
      if (dimension.minEvidence !== undefined && (!Number.isInteger(dimension.minEvidence) || dimension.minEvidence < 0)) {
        throw new Error(`dimension "${dimension.id}" minEvidence must be a non-negative integer`);
      }
    }
    for (const band of profile.bands || []) validateBand(band, scale, profile.name);
    const gateIds = new Set<string>();
    for (const gate of profile.gates || []) {
      if (!isNonEmptyString(gate.id)) throw new Error(`profile "${profile.name}" has a gate with an invalid id`);
      if (gateIds.has(gate.id)) throw new Error(`duplicate gate id "${gate.id}" in profile "${profile.name}"`);
      gateIds.add(gate.id);
      if (gate.min !== undefined && !Number.isFinite(gate.min)) throw new Error(`gate "${gate.id}" min must be numeric`);
      if (gate.max !== undefined && !Number.isFinite(gate.max)) throw new Error(`gate "${gate.id}" max must be numeric`);
    }
  }
  return config;
}

export function computeScore(configInput: ScoreConfig | unknown, inputInput: ScoreInput | unknown, options: ComputeScoreOptions = {}): ScoreResult {
  const config = loadScoreConfig(configInput);
  const input = loadScoreInput(inputInput);
  const profile = selectProfile(config, options.profile || input.profile);
  const scale = normalizeScale(profile.scale, `profile "${profile.name}" scale`);
  const precision = scale.precision ?? DEFAULT_SCALE.precision ?? 2;
  const dimensionMap = normalizeDimensionInputs(input.dimensions);
  const issues: ScoreIssue[] = [];
  const dimensions: ScoreDimensionResult[] = [];
  const configuredIds = new Set(profile.dimensions.map((dimension) => dimension.id));

  for (const id of dimensionMap.keys()) {
    if (!configuredIds.has(id)) {
      issues.push({
        severity: "warn",
        code: "unknown-dimension",
        message: `input dimension "${id}" is not configured for profile "${profile.name}"`,
        dimension: id,
      });
    }
  }

  const scoredDimensions = profile.dimensions.filter((dimension) => dimensionMap.has(dimension.id));
  const totalWeight = scoredDimensions.reduce((sum, dimension) => sum + dimensionWeight(dimension), 0);
  let weightedNormalized = 0;

  for (const dimension of profile.dimensions) {
    const raw = dimensionMap.get(dimension.id);
    if (!raw) {
      if (dimension.required) {
        issues.push({
          severity: "error",
          code: "missing-required",
          message: `required dimension "${dimension.id}" is missing`,
          dimension: dimension.id,
        });
      }
      continue;
    }

    const score = raw.score;
    if (!Number.isFinite(score)) {
      issues.push({
        severity: "error",
        code: "invalid-score",
        message: `dimension "${dimension.id}" score must be numeric`,
        dimension: dimension.id,
      });
      continue;
    }

    if (score < scale.min || score > scale.max) {
      issues.push({
        severity: "error",
        code: "score-out-of-range",
        message: `dimension "${dimension.id}" score ${score} is outside ${scale.min}-${scale.max}`,
        dimension: dimension.id,
      });
    }

    const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((item) => typeof item === "string" && item.length > 0) : [];
    const minEvidence = dimension.minEvidence ?? 0;
    if (evidence.length < minEvidence) {
      issues.push({
        severity: dimension.required ? "error" : "warn",
        code: "missing-evidence",
        message: `dimension "${dimension.id}" requires at least ${minEvidence} evidence item(s)`,
        dimension: dimension.id,
      });
    }

    const normalized = normalizeScore(score, scale);
    const normalizedWeight = totalWeight > 0 ? dimensionWeight(dimension) / totalWeight : 0;
    const contribution = normalized * normalizedWeight;
    weightedNormalized += contribution;
    dimensions.push(stripUndefined({
      id: dimension.id,
      label: dimension.label || dimension.id,
      weight: dimensionWeight(dimension),
      required: Boolean(dimension.required),
      score: round(score, precision),
      weighted: round(contribution * (scale.max - scale.min), precision),
      normalized: round(normalized, 4),
      evidence,
      note: raw.note,
    }));
  }

  if (dimensions.length === 0) {
    issues.push({
      severity: "error",
      code: "no-scored-dimensions",
      message: "no configured dimensions had usable scores",
    });
  }

  const normalized = clamp(weightedNormalized, 0, 1);
  const score = round(scale.min + normalized * (scale.max - scale.min), precision);
  const band = selectBand(profile.bands || [], score);
  const resultWithoutId = stripUndefined({
    schemaVersion: 1 as const,
    profile: profile.name,
    subject: input.subject,
    minScore: scale.min,
    maxScore: scale.max,
    score,
    normalized: round(normalized, 4),
    band,
    dimensions,
    gates: [] as ScoreGateResult[],
    issues,
    facts: input.facts,
    meta: input.meta,
  });
  const gates = (profile.gates || []).map((gate) => evaluateGatePolicy(gate, resultWithoutId));
  const result = stripUndefined({ ...resultWithoutId, gates, id: "" }) as ScoreResult;
  result.id = scoreResultId(result);
  return result;
}

export function checkScore(config: ScoreConfig | unknown, input: ScoreInput | unknown, options: ComputeScoreOptions = {}): CheckScoreResult {
  const result = computeScore(config, input, options);
  const errors = result.issues.filter((issue) => issue.severity === "error").length;
  const warnings = result.issues.filter((issue) => issue.severity === "warn").length;
  const gatesPass = result.gates.every((gate) => gate.pass);
  return {
    ok: errors === 0 && gatesPass,
    errors,
    warnings,
    result,
    issues: result.issues,
  };
}

export function evaluateGate(config: ScoreConfig | unknown, input: ScoreInput | unknown, options: EvaluateGateOptions = {}): EvaluateGateResult {
  const result = computeScore(config, input, options);
  if (!result.gates.length) throw new Error(`profile "${result.profile}" has no gates`);
  const gate = options.gate
    ? result.gates.find((candidate) => candidate.id === options.gate)
    : result.gates[0];
  if (!gate) throw new Error(`gate "${options.gate}" not found in profile "${result.profile}"`);
  return { ok: gate.pass, gate, result };
}

export function compareScoreResults(left: ScoreResult, right: ScoreResult): ScoreComparison {
  const precision = Math.max(decimalPlaces(left.score), decimalPlaces(right.score), 2);
  const delta = round(left.score - right.score, precision);
  const winner = delta > 0 ? "left" : delta < 0 ? "right" : "tie";
  const reason = winner === "tie"
    ? `scores are tied at ${left.score}`
    : `${winner} score is higher by ${Math.abs(delta)}`;
  return { winner, delta: Math.abs(delta), left, right, reason };
}

export function verifyScoreResult(value: unknown): ScoreVerifyResult {
  const issues: ScoreIssue[] = [];
  if (!isJsonObject(value)) {
    return issueResult({ severity: "error", code: "invalid-result", message: "score result must be a JSON object" });
  }
  const result = value as unknown as ScoreResult;
  if (result.schemaVersion !== 1) issues.push(error("invalid-schema", "schemaVersion must be 1"));
  if (!isNonEmptyString(result.id)) issues.push(error("invalid-id", "id must be a non-empty string"));
  if (!isNonEmptyString(result.profile)) issues.push(error("invalid-profile", "profile must be a non-empty string"));
  if (!Number.isFinite(result.minScore)) issues.push(error("invalid-min-score", "minScore must be numeric"));
  if (!Number.isFinite(result.maxScore)) issues.push(error("invalid-max-score", "maxScore must be numeric"));
  if (!Number.isFinite(result.score)) issues.push(error("invalid-score", "score must be numeric"));
  if (!Number.isFinite(result.normalized) || result.normalized < 0 || result.normalized > 1) {
    issues.push(error("invalid-normalized", "normalized must be between 0 and 1"));
  }
  if (Number.isFinite(result.score) && Number.isFinite(result.minScore) && Number.isFinite(result.maxScore)) {
    if (result.score < result.minScore || result.score > result.maxScore) {
      issues.push(error("score-out-of-range", `score ${result.score} is outside ${result.minScore}-${result.maxScore}`));
    }
  }
  if (!Array.isArray(result.dimensions)) issues.push(error("invalid-dimensions", "dimensions must be an array"));
  if (!Array.isArray(result.gates)) issues.push(error("invalid-gates", "gates must be an array"));
  if (!Array.isArray(result.issues)) issues.push(error("invalid-issues", "issues must be an array"));
  if (Array.isArray(result.dimensions)) {
    for (const [index, dimension] of result.dimensions.entries()) {
      if (!isNonEmptyString(dimension.id)) {
        issues.push(error("invalid-dimension", `dimensions[${index}].id must be a non-empty string`));
      }
      if (!Number.isFinite(dimension.score)) issues.push(error("invalid-dimension-score", `dimensions[${index}].score must be numeric`));
      if (!Number.isFinite(dimension.weight) || dimension.weight <= 0) {
        issues.push(error("invalid-dimension-weight", `dimensions[${index}].weight must be positive`));
      }
    }
  }
  if (Array.isArray(result.gates)) {
    for (const [index, gate] of result.gates.entries()) {
      if (!isNonEmptyString(gate.id)) issues.push(error("invalid-gate", `gates[${index}].id must be a non-empty string`));
      if (typeof gate.pass !== "boolean") issues.push(error("invalid-gate-pass", `gates[${index}].pass must be boolean`));
    }
  }
  if (Array.isArray(result.issues)) {
    for (const [index, issue] of result.issues.entries()) {
      if (issue.severity !== "error" && issue.severity !== "warn") {
        issues.push(error("invalid-issue-severity", `issues[${index}].severity must be error or warn`));
      }
      if (!isNonEmptyString(issue.code)) issues.push(error("invalid-issue-code", `issues[${index}].code must be a non-empty string`));
    }
  }
  if (isNonEmptyString(result.id)) {
    const expected = scoreResultId(result);
    if (result.id !== expected) {
      issues.push(error("id-mismatch", `id does not match content hash; expected ${expected}`));
    }
  }
  return issueResult(...issues);
}

export function scoreResultId(result: ScoreResult | Omit<ScoreResult, "id">): string {
  const payload = { ...(result as ScoreResult) };
  delete (payload as Partial<ScoreResult>).id;
  const hash = createHash("sha256").update(stableStringify(toJsonValue(payload))).digest("hex").slice(0, 16);
  return `score:${hash}`;
}

function loadScoreInput(input: unknown): ScoreInput {
  const value = requireObject(input, "input") as unknown as ScoreInput;
  if (!("dimensions" in value)) throw new Error("input.dimensions is required");
  if (!Array.isArray(value.dimensions) && !isJsonObject(value.dimensions)) {
    throw new Error("input.dimensions must be an object or array");
  }
  if (value.facts !== undefined && !isJsonObject(value.facts)) throw new Error("input.facts must be an object");
  if (value.meta !== undefined && !isJsonObject(value.meta)) throw new Error("input.meta must be an object");
  return value;
}

function normalizeDimensionInputs(dimensions: ScoreInput["dimensions"]): Map<string, ScoreDimensionInput> {
  const out = new Map<string, ScoreDimensionInput>();
  if (Array.isArray(dimensions)) {
    for (let i = 0; i < dimensions.length; i++) {
      const dimension = requireObject(dimensions[i], `dimensions[${i}]`) as unknown as ScoreDimensionInput;
      if (!isNonEmptyString(dimension.id)) throw new Error(`dimensions[${i}].id must be a non-empty string`);
      out.set(dimension.id, dimension);
    }
    return out;
  }
  for (const [id, raw] of Object.entries(dimensions)) {
    const dimension = requireObject(raw, `dimensions.${id}`) as unknown as ScoreDimensionInput;
    out.set(id, { ...dimension, id });
  }
  return out;
}

function selectProfile(config: ScoreConfig, requested?: string): ScoreProfile {
  if (requested) {
    const profile = config.profiles.find((candidate) => candidate.name === requested);
    if (!profile) throw new Error(`profile "${requested}" not found`);
    return profile;
  }
  const first = config.profiles[0];
  if (!first) throw new Error("config.profiles must be non-empty");
  return first;
}

function normalizeScale(scale: ScoreScale | undefined, path: string): ScoreScale {
  const value = scale || DEFAULT_SCALE;
  if (!Number.isFinite(value.min)) throw new Error(`${path}.min must be numeric`);
  if (!Number.isFinite(value.max)) throw new Error(`${path}.max must be numeric`);
  if (value.max <= value.min) throw new Error(`${path}.max must be greater than min`);
  if (value.precision !== undefined && (!Number.isInteger(value.precision) || value.precision < 0 || value.precision > 6)) {
    throw new Error(`${path}.precision must be an integer from 0 to 6`);
  }
  return { min: value.min, max: value.max, precision: value.precision ?? DEFAULT_SCALE.precision };
}

function validateBand(band: ScoreBandConfig, scale: ScoreScale, profile: string): void {
  if (!isNonEmptyString(band.id)) throw new Error(`profile "${profile}" has a band with an invalid id`);
  if (!Number.isFinite(band.min)) throw new Error(`band "${band.id}" min must be numeric`);
  if (band.max !== undefined && !Number.isFinite(band.max)) throw new Error(`band "${band.id}" max must be numeric`);
  if (band.max !== undefined && band.max < band.min) throw new Error(`band "${band.id}" max must be >= min`);
  if (band.min < scale.min || band.min > scale.max) throw new Error(`band "${band.id}" min is outside scale`);
}

function selectBand(bands: ScoreBandConfig[], score: number): ScoreBandResult | undefined {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const band = sorted.find((candidate) => score >= candidate.min && (candidate.max === undefined || score <= candidate.max));
  if (!band) return undefined;
  return stripUndefined({
    id: band.id,
    label: band.label || band.id,
    min: band.min,
    max: band.max,
  });
}

function evaluateGatePolicy(gate: ScoreGateConfig, result: Omit<ScoreResult, "id">): ScoreGateResult {
  const failures: string[] = [];
  if (gate.min !== undefined && result.score < gate.min) failures.push(`score ${result.score} < ${gate.min}`);
  if (gate.max !== undefined && result.score > gate.max) failures.push(`score ${result.score} > ${gate.max}`);
  const requiredBands = gate.requireBand === undefined
    ? []
    : Array.isArray(gate.requireBand)
      ? gate.requireBand
      : [gate.requireBand];
  if (requiredBands.length && (!result.band || !requiredBands.includes(result.band.id))) {
    failures.push(`band ${result.band?.id || "none"} not in ${requiredBands.join(", ")}`);
  }
  if (gate.blockOnMissingRequired && result.issues.some((issue) => issue.code === "missing-required" || (issue.code === "missing-evidence" && issue.severity === "error"))) {
    failures.push("required dimension evidence is missing");
  }
  if (gate.blockOnIssues && result.issues.some((issue) => issue.severity === "error")) {
    failures.push("score has error issues");
  }

  const pass = failures.length === 0;
  let reason = pass ? "gate passed" : failures.join("; ");
  if (pass && gate.min !== undefined) reason = `score ${result.score} >= ${gate.min}`;
  if (pass && requiredBands.length) reason = `${reason}; band ${result.band?.id || "none"} accepted`;
  return {
    id: gate.id,
    label: gate.label || gate.id,
    pass,
    reason,
  };
}

function dimensionWeight(dimension: ScoreDimensionConfig): number {
  return dimension.weight ?? 1;
}

function normalizeScore(score: number, scale: ScoreScale): number {
  return clamp((score - scale.min) / (scale.max - scale.min), 0, 1);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function decimalPlaces(value: number): number {
  const [, decimals = ""] = String(value).split(".");
  return decimals.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${path} must be a JSON object`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function error(code: string, message: string): ScoreIssue {
  return { severity: "error", code, message };
}

function issueResult(...issues: ScoreIssue[]): ScoreVerifyResult {
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warn").length,
    issues,
  };
}

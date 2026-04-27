export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface ScoreConfig {
  version: 1;
  profiles: ScoreProfile[];
}

export interface ScoreProfile {
  name: string;
  description?: string;
  scale?: ScoreScale;
  dimensions: ScoreDimensionConfig[];
  bands?: ScoreBandConfig[];
  gates?: ScoreGateConfig[];
}

export interface ScoreScale {
  min: number;
  max: number;
  precision?: number;
}

export interface ScoreDimensionConfig {
  id: string;
  label?: string;
  description?: string;
  weight?: number;
  required?: boolean;
  minEvidence?: number;
}

export interface ScoreBandConfig {
  id: string;
  label?: string;
  min: number;
  max?: number;
}

export interface ScoreGateConfig {
  id: string;
  label?: string;
  min?: number;
  max?: number;
  requireBand?: string | string[];
  blockOnMissingRequired?: boolean;
  blockOnIssues?: boolean;
}

export interface ScoreInput {
  subject?: string;
  profile?: string;
  dimensions: Record<string, ScoreDimensionInput> | ScoreDimensionInput[];
  facts?: JsonObject;
  meta?: JsonObject;
}

export interface ScoreDimensionInput {
  id?: string;
  score: number;
  evidence?: string[];
  note?: string;
  value?: JsonValue;
}

export type IssueSeverity = "error" | "warn";

export interface ScoreIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  dimension?: string;
  gate?: string;
  path?: string;
}

export interface ScoreBandResult {
  id: string;
  label: string;
  min: number;
  max?: number;
}

export interface ScoreDimensionResult {
  id: string;
  label: string;
  weight: number;
  required: boolean;
  score: number;
  weighted: number;
  normalized: number;
  evidence: string[];
  note?: string;
}

export interface ScoreGateResult {
  id: string;
  label: string;
  pass: boolean;
  reason: string;
}

export interface ScoreResult {
  schemaVersion: 1;
  id: string;
  profile: string;
  subject?: string;
  minScore: number;
  maxScore: number;
  score: number;
  normalized: number;
  band?: ScoreBandResult;
  dimensions: ScoreDimensionResult[];
  gates: ScoreGateResult[];
  issues: ScoreIssue[];
  facts?: JsonObject;
  meta?: JsonObject;
}

export interface ComputeScoreOptions {
  profile?: string;
}

export interface CheckScoreResult {
  ok: boolean;
  errors: number;
  warnings: number;
  result: ScoreResult;
  issues: ScoreIssue[];
}

export interface EvaluateGateOptions extends ComputeScoreOptions {
  gate?: string;
}

export interface EvaluateGateResult {
  ok: boolean;
  gate: ScoreGateResult;
  result: ScoreResult;
}

export interface ScoreVerifyResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ScoreIssue[];
}

export type ScoreComparisonWinner = "left" | "right" | "tie";

export interface ScoreComparison {
  winner: ScoreComparisonWinner;
  delta: number;
  left: ScoreResult;
  right: ScoreResult;
  reason: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type RenderTarget = "markdown" | "json";

export interface ContextDefaults {
  root?: string;
  tokenBudget?: number;
  charsPerToken?: number;
}

export interface ContextFileSpec {
  path: string;
  label?: string;
  required?: boolean;
  maxTokens?: number;
  notes?: string[];
}

export type ContextFileInput = string | ContextFileSpec;

export interface ContextBundle {
  name: string;
  description?: string;
  extends?: string | string[];
  files?: ContextFileInput[];
  tokenBudget?: number;
  charsPerToken?: number;
  notes?: string[];
}

export interface ContextPolicy {
  defaults?: ContextDefaults;
  bundles: ContextBundle[];
}

export type ContextInput = ContextPolicy | ContextBundle | ContextBundle[];

export interface ResolvedContextFileSpec {
  path: string;
  label?: string;
  required: boolean;
  maxTokens?: number;
  notes: string[];
}

export interface ResolvedContextBundle {
  name: string;
  description?: string;
  extends: string[];
  files: ResolvedContextFileSpec[];
  tokenBudget?: number;
  charsPerToken?: number;
  notes: string[];
}

export interface ContextPlanOptions {
  root?: string;
  includeContent?: boolean;
  tokenBudget?: number;
  charsPerToken?: number;
}

export interface ContextFilePlan {
  path: string;
  absolutePath: string;
  label?: string;
  required: boolean;
  exists: boolean;
  bytes: number;
  chars: number;
  tokens: number;
  maxTokens?: number;
  notes: string[];
  content?: string;
}

export type ContextIssueKind =
  | "missing-required-file"
  | "not-a-file"
  | "read-error"
  | "file-over-budget"
  | "bundle-over-budget";

export interface ContextIssue {
  kind: ContextIssueKind;
  severity: "error" | "warn";
  message: string;
  path?: string;
  tokens?: number;
  maxTokens?: number;
}

export interface ContextPlanTotals {
  files: number;
  existing: number;
  bytes: number;
  chars: number;
  tokens: number;
}

export interface ContextPlan {
  ok: boolean;
  bundle: ResolvedContextBundle;
  root: string;
  tokenBudget?: number;
  charsPerToken: number;
  files: ContextFilePlan[];
  totals: ContextPlanTotals;
  issues: ContextIssue[];
}

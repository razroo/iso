import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isJsonObject } from "./json.js";
import type {
  ContextBundle,
  ContextFileInput,
  ContextFilePlan,
  ContextFileSpec,
  ContextInput,
  ContextIssue,
  ContextPlan,
  ContextPlanOptions,
  ContextPolicy,
  ResolvedContextBundle,
  ResolvedContextFileSpec,
} from "./types.js";

const DEFAULT_CHARS_PER_TOKEN = 4;

export function loadContextPolicy(input: ContextInput): ContextPolicy {
  const bundles = Array.isArray(input)
    ? input
    : isContextPolicy(input)
      ? input.bundles
      : [input as ContextBundle];

  if (!bundles.length) throw new Error("context policy must define at least one bundle");

  const normalized = bundles.map((bundle) => normalizeBundle(bundle));
  const seen = new Set<string>();
  for (const bundle of normalized) {
    if (seen.has(bundle.name)) throw new Error(`duplicate context bundle "${bundle.name}"`);
    seen.add(bundle.name);
  }

  for (const bundle of normalized) {
    for (const parent of parentNames(bundle)) {
      if (!seen.has(parent)) throw new Error(`context bundle "${bundle.name}" extends unknown bundle "${parent}"`);
    }
  }

  const policy: ContextPolicy = {
    bundles: normalized,
  };

  if (isContextPolicy(input) && input.defaults !== undefined) {
    policy.defaults = normalizeDefaults(input.defaults);
  }

  for (const bundle of normalized) resolveContextBundle(policy, bundle.name);
  return policy;
}

export function bundleNames(policy: ContextPolicy): string[] {
  return policy.bundles.map((bundle) => bundle.name).sort();
}

export function getContextBundle(policy: ContextPolicy, name: string): ContextBundle {
  const bundle = policy.bundles.find((candidate) => candidate.name === name);
  if (!bundle) {
    const available = bundleNames(policy).join(", ") || "(none)";
    throw new Error(`unknown context bundle "${name}" (available: ${available})`);
  }
  return bundle;
}

export function resolveContextBundle(policy: ContextPolicy, name: string): ResolvedContextBundle {
  const byName = new Map(policy.bundles.map((bundle) => [bundle.name, bundle] as const));
  return resolveWithStack(byName, name, []);
}

export function planContext(
  policy: ContextPolicy,
  bundleName: string,
  options: ContextPlanOptions = {},
): ContextPlan {
  const bundle = resolveContextBundle(policy, bundleName);
  const root = resolve(options.root || policy.defaults?.root || process.cwd());
  const charsPerToken = positiveInteger(
    options.charsPerToken ?? bundle.charsPerToken ?? policy.defaults?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN,
    "charsPerToken",
  );
  const tokenBudget = optionalPositiveInteger(
    options.tokenBudget ?? bundle.tokenBudget ?? policy.defaults?.tokenBudget,
    "tokenBudget",
  );

  const issues: ContextIssue[] = [];
  const files = bundle.files.map((file) => planFile(file, root, charsPerToken, Boolean(options.includeContent), issues));
  const totals = files.reduce(
    (acc, file) => ({
      files: acc.files + 1,
      existing: acc.existing + (file.exists ? 1 : 0),
      bytes: acc.bytes + file.bytes,
      chars: acc.chars + file.chars,
      tokens: acc.tokens + file.tokens,
    }),
    { files: 0, existing: 0, bytes: 0, chars: 0, tokens: 0 },
  );

  if (tokenBudget !== undefined && totals.tokens > tokenBudget) {
    issues.push({
      kind: "bundle-over-budget",
      severity: "error",
      message: `bundle "${bundle.name}" uses ${totals.tokens} estimated tokens over budget ${tokenBudget}`,
      tokens: totals.tokens,
      maxTokens: tokenBudget,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    bundle,
    root,
    tokenBudget,
    charsPerToken,
    files,
    totals,
    issues,
  };
}

export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  const divisor = positiveInteger(charsPerToken, "charsPerToken");
  if (!text.length) return 0;
  return Math.max(1, Math.ceil(text.length / divisor));
}

function planFile(
  file: ResolvedContextFileSpec,
  root: string,
  charsPerToken: number,
  includeContent: boolean,
  issues: ContextIssue[],
): ContextFilePlan {
  const absolutePath = resolve(root, file.path);
  const base: ContextFilePlan = {
    path: file.path,
    absolutePath,
    label: file.label,
    required: file.required,
    exists: false,
    bytes: 0,
    chars: 0,
    tokens: 0,
    maxTokens: file.maxTokens,
    notes: file.notes,
  };

  if (!existsSync(absolutePath)) {
    if (file.required) {
      issues.push({
        kind: "missing-required-file",
        severity: "error",
        path: file.path,
        message: `required context file "${file.path}" is missing`,
      });
    }
    return base;
  }

  const stat = statSync(absolutePath);
  if (!stat.isFile()) {
    issues.push({
      kind: "not-a-file",
      severity: "error",
      path: file.path,
      message: `context path "${file.path}" is not a file`,
    });
    return { ...base, exists: true };
  }

  try {
    const content = readFileSync(absolutePath, "utf8");
    const tokens = estimateTokens(content, charsPerToken);
    const planned = {
      ...base,
      exists: true,
      bytes: Buffer.byteLength(content, "utf8"),
      chars: content.length,
      tokens,
      content: includeContent ? content : undefined,
    };
    if (file.maxTokens !== undefined && tokens > file.maxTokens) {
      issues.push({
        kind: "file-over-budget",
        severity: "error",
        path: file.path,
        message: `context file "${file.path}" uses ${tokens} estimated tokens over budget ${file.maxTokens}`,
        tokens,
        maxTokens: file.maxTokens,
      });
    }
    return planned;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push({
      kind: "read-error",
      severity: "error",
      path: file.path,
      message: `could not read context file "${file.path}": ${detail}`,
    });
    return { ...base, exists: true };
  }
}

function resolveWithStack(
  bundles: Map<string, ContextBundle>,
  name: string,
  stack: string[],
): ResolvedContextBundle {
  const bundle = bundles.get(name);
  if (!bundle) {
    const available = [...bundles.keys()].sort().join(", ") || "(none)";
    throw new Error(`unknown context bundle "${name}" (available: ${available})`);
  }
  if (stack.includes(name)) {
    throw new Error(`context bundle cycle: ${[...stack, name].join(" -> ")}`);
  }

  const parents = parentNames(bundle);
  let resolved = emptyResolvedBundle(bundle.name, parents);
  for (const parent of parents) {
    resolved = mergeParent(resolved, resolveWithStack(bundles, parent, [...stack, name]));
  }
  return applyBundle(resolved, bundle);
}

function emptyResolvedBundle(name: string, parents: string[]): ResolvedContextBundle {
  return {
    name,
    extends: parents,
    files: [],
    notes: [],
  };
}

function mergeParent(base: ResolvedContextBundle, parent: ResolvedContextBundle): ResolvedContextBundle {
  return {
    ...base,
    description: base.description ?? parent.description,
    files: mergeFiles(parent.files, base.files),
    tokenBudget: parent.tokenBudget,
    charsPerToken: parent.charsPerToken,
    notes: unique([...parent.notes, ...base.notes]),
  };
}

function applyBundle(base: ResolvedContextBundle, bundle: ContextBundle): ResolvedContextBundle {
  return {
    ...base,
    description: bundle.description ?? base.description,
    files: mergeFiles(base.files, (bundle.files || []).map((file) => normalizeFile(file, `${bundle.name}.files`))),
    tokenBudget: bundle.tokenBudget ?? base.tokenBudget,
    charsPerToken: bundle.charsPerToken ?? base.charsPerToken,
    notes: unique([...base.notes, ...(bundle.notes || [])]),
  };
}

function mergeFiles(
  inherited: ResolvedContextFileSpec[],
  added: ResolvedContextFileSpec[],
): ResolvedContextFileSpec[] {
  const order: string[] = [];
  const byPath = new Map<string, ResolvedContextFileSpec>();
  for (const file of [...inherited, ...added]) {
    if (!byPath.has(file.path)) order.push(file.path);
    const previous = byPath.get(file.path);
    byPath.set(file.path, previous ? { ...previous, ...file, notes: unique([...previous.notes, ...file.notes]) } : file);
  }
  return order.map((path) => byPath.get(path)).filter((file): file is ResolvedContextFileSpec => Boolean(file));
}

function normalizeDefaults(value: unknown): ContextPolicy["defaults"] {
  if (!isJsonObject(value)) throw new Error("context defaults must be a JSON object");
  const defaults: ContextPolicy["defaults"] = {};
  if (value.root !== undefined) defaults.root = requireString(value.root, "defaults.root");
  if (value.tokenBudget !== undefined) defaults.tokenBudget = positiveInteger(value.tokenBudget, "defaults.tokenBudget");
  if (value.charsPerToken !== undefined) {
    defaults.charsPerToken = positiveInteger(value.charsPerToken, "defaults.charsPerToken");
  }
  return defaults;
}

function normalizeBundle(value: unknown): ContextBundle {
  if (!isJsonObject(value)) throw new Error("context bundle must be a JSON object");
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("context bundle name must be a non-empty string");
  }

  const name = value.name.trim();
  const bundle: ContextBundle = { name };
  if (value.description !== undefined) bundle.description = requireString(value.description, `${name}.description`);
  if (value.extends !== undefined) bundle.extends = normalizeExtends(value.extends, `${name}.extends`);
  if (value.files !== undefined) bundle.files = normalizeFileInputs(value.files, `${name}.files`);
  if (value.tokenBudget !== undefined) bundle.tokenBudget = positiveInteger(value.tokenBudget, `${name}.tokenBudget`);
  if (value.charsPerToken !== undefined) bundle.charsPerToken = positiveInteger(value.charsPerToken, `${name}.charsPerToken`);
  if (value.notes !== undefined) bundle.notes = normalizeStringArray(value.notes, `${name}.notes`);
  return bundle;
}

function normalizeFileInputs(value: unknown, path: string): ContextFileInput[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => normalizeFileInput(item, `${path}[${index}]`));
}

function normalizeFileInput(value: unknown, path: string): ContextFileInput {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`${path} must not be empty`);
    return value.trim();
  }
  return normalizeFileSpec(value, path);
}

function normalizeFile(value: ContextFileInput, path: string): ResolvedContextFileSpec {
  if (typeof value === "string") {
    return { path: value, required: true, notes: [] };
  }
  return normalizeFileSpec(value, path);
}

function normalizeFileSpec(value: unknown, path: string): ResolvedContextFileSpec {
  if (!isJsonObject(value)) throw new Error(`${path} must be a string or JSON object`);
  const rawPath = requireString(value.path, `${path}.path`);
  if (!rawPath) throw new Error(`${path}.path must not be empty`);
  const spec: ResolvedContextFileSpec = {
    path: rawPath,
    required: value.required === undefined ? true : requireBoolean(value.required, `${path}.required`),
    notes: [],
  };
  if (value.label !== undefined) spec.label = requireString(value.label, `${path}.label`);
  if (value.maxTokens !== undefined) spec.maxTokens = positiveInteger(value.maxTokens, `${path}.maxTokens`);
  if (value.notes !== undefined) spec.notes = normalizeStringArray(value.notes, `${path}.notes`);
  return spec;
}

function isContextPolicy(input: ContextInput): input is ContextPolicy {
  return isJsonObject(input) && Array.isArray((input as { bundles?: unknown }).bundles);
}

function parentNames(bundle: ContextBundle): string[] {
  if (!bundle.extends) return [];
  const parents = Array.isArray(bundle.extends) ? bundle.extends : [bundle.extends];
  return unique(parents.map((parent) => parent.trim()).filter(Boolean));
}

function normalizeExtends(value: unknown, path: string): string | string[] {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`${path} must not be empty`);
    return value.trim();
  }
  return normalizeStringArray(value, path);
}

function normalizeStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of strings`);
  const result = value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${path}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
  return unique(result);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value.trim();
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return positiveInteger(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

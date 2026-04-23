import { fetchOpenRouterModels, type OpenRouterModel } from "./catalog.js";
import { loadPolicy } from "./parser.js";
import type { HarnessTarget, ModelPolicy, Provider, ProviderModel, Reasoning } from "./types.js";

export interface ModelReference {
  where: string;
  provider: Provider;
  model: string;
  reasoning?: Reasoning;
}

export interface VerifyIssue {
  where: string;
  provider: Provider;
  model: string;
  message: string;
  severity: "error" | "warning";
}

export interface VerifyResult {
  sourcePath: string;
  refs: ModelReference[];
  verified: ModelReference[];
  unverifiable: ModelReference[];
  errors: VerifyIssue[];
  warnings: VerifyIssue[];
  passed: boolean;
}

export interface VerifyOptions {
  endpoint?: string;
  failOnUnverifiable?: boolean;
  fetchOpenRouterModelsImpl?: (opts?: { endpoint?: string }) => Promise<OpenRouterModel[]>;
}

export function collectModelReferences(policy: ModelPolicy): ModelReference[] {
  const refs: ModelReference[] = [];
  collectProviderModel(refs, "default", policy.default);
  for (const role of policy.roles) {
    collectProviderModel(refs, `roles.${role.name}`, role);
    role.fallback?.forEach((fallback, index) => {
      collectProviderModel(refs, `roles.${role.name}.fallback[${index}]`, fallback);
    });
  }
  return refs;
}

export async function verifyPolicyModels(
  policy: ModelPolicy,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const refs = collectModelReferences(policy);
  const verified: ModelReference[] = [];
  const unverifiable = refs.filter((ref) => ref.provider !== "openrouter");
  const errors: VerifyIssue[] = [];
  const warnings: VerifyIssue[] = [];

  const openrouterRefs = refs.filter((ref) => ref.provider === "openrouter");
  if (openrouterRefs.length > 0) {
    const fetchImpl = opts.fetchOpenRouterModelsImpl ?? ((input?: { endpoint?: string }) =>
      fetchOpenRouterModels({ endpoint: input?.endpoint }));
    const models = await fetchImpl({ endpoint: opts.endpoint });
    const byId = new Map(models.map((model) => [model.id, model]));
    for (const ref of openrouterRefs) {
      const model = byId.get(ref.model);
      if (!model) {
        errors.push({
          where: ref.where,
          provider: ref.provider,
          model: ref.model,
          severity: "error",
          message: "not found in the OpenRouter Models API",
        });
        continue;
      }
      verified.push(ref);
      if (!supports(model, "tools")) {
        warnings.push({
          where: ref.where,
          provider: ref.provider,
          model: ref.model,
          severity: "warning",
          message: "does not advertise tool support",
        });
      }
      if (ref.reasoning && !supports(model, "reasoning") && !supports(model, "include_reasoning")) {
        warnings.push({
          where: ref.where,
          provider: ref.provider,
          model: ref.model,
          severity: "warning",
          message: `does not advertise reasoning support (requested: ${ref.reasoning})`,
        });
      }
    }
  }

  return {
    sourcePath: policy.sourcePath,
    refs,
    verified,
    unverifiable,
    errors,
    warnings,
    passed: errors.length === 0 && (!opts.failOnUnverifiable || unverifiable.length === 0),
  };
}

export async function verifyModelFile(path: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  return verifyPolicyModels(loadPolicy(path), opts);
}

export function formatVerifyResult(result: VerifyResult, opts: { failOnUnverifiable?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`iso-route: verify ${result.sourcePath}`);
  lines.push(`  refs:         ${result.refs.length}`);
  lines.push(`  verified:     ${result.verified.length} via OpenRouter`);
  lines.push(`  unverifiable: ${result.unverifiable.length}`);
  lines.push(`  errors:       ${result.errors.length}`);
  lines.push(`  warnings:     ${result.warnings.length}`);

  if (result.unverifiable.length > 0) {
    const grouped = groupProviders(result.unverifiable);
    lines.push("");
    lines.push(`unverifiable providers:`);
    for (const [provider, count] of grouped) {
      lines.push(`  - ${provider}: ${count} reference(s)`);
    }
    if (!opts.failOnUnverifiable) {
      lines.push(`  note: only OpenRouter IDs are verified today; other providers are advisory.`);
    }
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("errors:");
    for (const issue of result.errors) {
      lines.push(`  - ${issue.where}: ${issue.provider}/${issue.model} ${issue.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("warnings:");
    for (const issue of result.warnings) {
      lines.push(`  - ${issue.where}: ${issue.provider}/${issue.model} ${issue.message}`);
    }
  }

  lines.push("");
  lines.push(result.passed ? "PASS" : "FAIL");
  return lines.join("\n");
}

function collectProviderModel(
  refs: ModelReference[],
  where: string,
  model: ProviderModel,
): void {
  refs.push({
    where,
    provider: model.provider,
    model: model.model,
    reasoning: model.reasoning,
  });
  for (const target of targetsOf(model)) {
    const override = model.targets?.[target];
    if (!override) continue;
    refs.push({
      where: `${where}.targets.${target}`,
      provider: override.provider,
      model: override.model,
      reasoning: override.reasoning,
    });
  }
}

function targetsOf(model: ProviderModel): HarnessTarget[] {
  return (Object.keys(model.targets ?? {}) as HarnessTarget[]).sort();
}

function supports(model: OpenRouterModel, parameter: string): boolean {
  return (model.supported_parameters ?? []).includes(parameter);
}

function groupProviders(refs: ModelReference[]): [Provider, number][] {
  const counts = new Map<Provider, number>();
  for (const ref of refs) counts.set(ref.provider, (counts.get(ref.provider) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

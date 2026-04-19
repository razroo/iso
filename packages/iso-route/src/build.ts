import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadPolicy } from "./parser.js";
import { emitClaude } from "./targets/claude.js";
import { emitCodex } from "./targets/codex.js";
import { emitCursor } from "./targets/cursor.js";
import { emitOpenCode } from "./targets/opencode.js";
import type {
  BuildResult,
  EmitResult,
  HarnessTarget,
  ModelPolicy,
  ProviderModel,
  Role,
} from "./types.js";

export const ALL_TARGETS: HarnessTarget[] = ["claude", "codex", "opencode", "cursor"];

export interface BuildOptions {
  source: string;
  out: string;
  targets?: HarnessTarget[];
  dryRun?: boolean;
}

export function build(opts: BuildOptions): BuildResult {
  const policy = loadPolicy(opts.source);
  const targets = opts.targets ?? ALL_TARGETS;
  const outDir = resolve(opts.out);
  const emits: EmitResult[] = [];
  // Flatten per-target overrides before handing each policy to its emitter.
  // Emitters then see a plain (provider + model + reasoning) on each role and
  // don't need to know that `targets:` overrides exist.
  for (const t of targets) emits.push(emitFor(t, resolvePolicyForTarget(policy, t)));

  if (!opts.dryRun) {
    for (const e of emits) {
      for (const f of e.files) {
        const full = resolve(outDir, f.path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, f.contents);
      }
    }
  }

  const warnings = emits.flatMap((e) => e.warnings);
  return { policy, emits, warnings };
}

/**
 * Apply `targets.<harness>` overrides on both the default and each role.
 * Returns a new policy with the override flattened into the top-level fields,
 * so emitters can read `role.provider` / `role.model` directly without
 * caring about target overrides.
 */
export function resolvePolicyForTarget(
  policy: ModelPolicy,
  target: HarnessTarget,
): ModelPolicy {
  return {
    ...policy,
    default: applyTargetOverride(policy.default, target),
    roles: policy.roles.map((r) => {
      const resolved = applyTargetOverride(r, target);
      const next: Role = {
        ...r,
        provider: resolved.provider,
        model: resolved.model,
      };
      if (resolved.reasoning !== undefined) next.reasoning = resolved.reasoning;
      else delete (next as Partial<Role>).reasoning;
      // `targets` should never be surfaced to emitters — they only see the
      // resolved values.
      delete (next as Partial<Role>).targets;
      return next;
    }),
  };
}

function applyTargetOverride<T extends ProviderModel>(
  p: T,
  target: HarnessTarget,
): ProviderModel {
  const override = p.targets?.[target];
  if (!override) {
    // Strip the targets field from the returned value so downstream emitters
    // don't leak it into output.
    const { targets: _t, ...rest } = p;
    return rest;
  }
  const out: ProviderModel = {
    provider: override.provider,
    model: override.model,
  };
  if (override.reasoning !== undefined) out.reasoning = override.reasoning;
  return out;
}

function emitFor(target: HarnessTarget, policy: ModelPolicy): EmitResult {
  switch (target) {
    case "claude":
      return emitClaude(policy);
    case "codex":
      return emitCodex(policy);
    case "opencode":
      return emitOpenCode(policy);
    case "cursor":
      return emitCursor(policy);
  }
}

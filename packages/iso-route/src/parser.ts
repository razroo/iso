import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type {
  HarnessTarget,
  ModelPolicy,
  Provider,
  ProviderModel,
  Reasoning,
  Role,
  TargetOverride,
} from "./types.js";

const VALID_PROVIDERS: ReadonlySet<Provider> = new Set<Provider>([
  "anthropic",
  "openai",
  "google",
  "xai",
  "deepseek",
  "mistral",
  "groq",
  "ollama",
  "openrouter",
  "opencode",
  "local",
]);

const VALID_REASONING: ReadonlySet<Reasoning> = new Set<Reasoning>(["low", "medium", "high"]);

const VALID_TARGETS: ReadonlySet<HarnessTarget> = new Set<HarnessTarget>([
  "claude",
  "codex",
  "opencode",
  "cursor",
]);

const ROLE_NAME_RE = /^[a-z][a-z0-9-]*$/;

// Resolve the absolute path to a bundled preset file. Works from both the
// compiled dist/ (tsc emits to dist/parser.js, so presets/ is two levels up)
// AND from the TypeScript source (tests import ../src/parser.js, so presets/
// is also two levels up). Prefer whichever exists.
function resolvePresetPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "presets", `${name}.yaml`),     // when running from dist/
    resolve(here, "..", "..", "presets", `${name}.yaml`), // when running from src/
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    `@razroo/iso-route: preset "${name}" not found. Built-in presets: ${listPresets().join(", ")}. ` +
      `Searched: ${candidates.join(", ")}`,
  );
}

export function listPresets(): string[] {
  // Kept in sync with the YAML files in presets/. Hardcoded so a package
  // consumer running the CLI doesn't have to walk the installed tarball's
  // filesystem at runtime.
  return ["standard", "budget", "openrouter-free"];
}

/**
 * Load a policy from disk. Handles `extends:` by recursively loading the
 * named preset, then recursively merging the user's fields on top. User
 * wins at every key; `roles` merge by name (each role becomes the
 * preset role overlaid with user's partial role); `targets` merge by
 * harness (each target override is atomic — user's override replaces the
 * preset's for that harness).
 */
export function loadPolicy(path: string): ModelPolicy {
  const sourcePath = resolve(path);
  const sourceDir = dirname(sourcePath);
  const raw = readFileSync(sourcePath, "utf8");
  return parsePolicyText(raw, sourcePath, sourceDir);
}

function parsePolicyText(
  raw: string,
  sourcePath: string,
  sourceDir: string,
): ModelPolicy {
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourcePath}: models file must be a YAML object`);
  }

  // If `extends:` is present, load the named preset as the base layer.
  const extendsKey = (parsed as Record<string, unknown>).extends;
  let base: Record<string, unknown> | null = null;
  if (extendsKey !== undefined) {
    if (typeof extendsKey !== "string" || !extendsKey) {
      throw new Error(`${sourcePath}: "extends" must be the name of a built-in preset (e.g. "standard")`);
    }
    const presetPath = resolvePresetPath(extendsKey);
    const presetRaw = readFileSync(presetPath, "utf8");
    const presetParsed = YAML.parse(presetRaw);
    if (!presetParsed || typeof presetParsed !== "object" || Array.isArray(presetParsed)) {
      throw new Error(`${presetPath}: preset must be a YAML object`);
    }
    if ((presetParsed as Record<string, unknown>).extends !== undefined) {
      throw new Error(`${presetPath}: presets cannot themselves use "extends" — keep them self-contained`);
    }
    base = presetParsed as Record<string, unknown>;
  }

  // Strip `extends:` before merging the user's own fields.
  const userFields: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  delete userFields.extends;

  // Merge user fields over preset base (user wins). When there's no preset
  // (no extends:), base is null and we use the user's fields directly.
  const effective = base ? deepMerge(base, userFields) : userFields;

  // Now parse the merged result as a regular policy.
  const def = effective.default;
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    throw new Error(
      `${sourcePath}: "default" (object with provider + model) is required` +
        (extendsKey ? ` (preset "${extendsKey}" should have provided one — are you on an old preset version?)` : ""),
    );
  }
  const defaultModel = parseProviderModel(def, "default", sourcePath);

  const rolesRaw = effective.roles;
  let roles: Role[] = [];
  if (rolesRaw != null) {
    if (typeof rolesRaw !== "object" || Array.isArray(rolesRaw)) {
      throw new Error(`${sourcePath}: "roles" must be an object mapping role-name → model config`);
    }
    roles = Object.entries(rolesRaw as Record<string, unknown>).map(([name, cfg]) =>
      parseRole(name, cfg, sourcePath),
    );
  }

  const seen = new Set<string>();
  for (const r of roles) {
    if (seen.has(r.name)) {
      throw new Error(`${sourcePath}: duplicate role "${r.name}"`);
    }
    seen.add(r.name);
  }

  return { default: defaultModel, roles, sourcePath, sourceDir };
}

/**
 * Merge `overlay` onto `base`. User wins at every key. Objects merge
 * recursively (field-by-field), arrays and scalars are replaced
 * atomically. `targets.<harness>` sub-objects are replaced as a unit, not
 * field-merged — a user's target override is treated as a complete
 * substitution for that harness.
 */
function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (v === undefined) continue;
    const existing = out[k];
    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      // targets.<harness> overrides are atomic — don't field-merge inside them.
      if (k === "targets") {
        const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
        for (const [harness, override] of Object.entries(v as Record<string, unknown>)) {
          if (override === null) delete merged[harness];
          else merged[harness] = override;
        }
        out[k] = merged;
      } else {
        out[k] = deepMerge(
          existing as Record<string, unknown>,
          v as Record<string, unknown>,
        );
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseProviderModel(raw: unknown, where: string, path: string): ProviderModel {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}: ${where} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const provider = r.provider;
  if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider as Provider)) {
    throw new Error(
      `${path}: ${where}.provider must be one of: ${[...VALID_PROVIDERS].join(", ")} — got "${String(provider)}"`,
    );
  }
  const model = r.model;
  if (typeof model !== "string" || !model) {
    throw new Error(`${path}: ${where}.model (non-empty string) is required`);
  }
  const out: ProviderModel = { provider: provider as Provider, model };
  if (r.reasoning != null) {
    if (typeof r.reasoning !== "string" || !VALID_REASONING.has(r.reasoning as Reasoning)) {
      throw new Error(
        `${path}: ${where}.reasoning must be one of: ${[...VALID_REASONING].join(", ")} — got "${String(r.reasoning)}"`,
      );
    }
    out.reasoning = r.reasoning as Reasoning;
  }
  if (r.targets != null) {
    if (typeof r.targets !== "object" || Array.isArray(r.targets)) {
      throw new Error(
        `${path}: ${where}.targets must be an object mapping harness → override`,
      );
    }
    const targets: Partial<Record<HarnessTarget, TargetOverride>> = {};
    for (const [name, cfg] of Object.entries(r.targets as Record<string, unknown>)) {
      if (!VALID_TARGETS.has(name as HarnessTarget)) {
        throw new Error(
          `${path}: ${where}.targets.${name} — unknown harness; valid: ${[...VALID_TARGETS].join(", ")}`,
        );
      }
      const override = parseProviderModel(cfg, `${where}.targets.${name}`, path);
      // Target overrides cannot themselves carry `.targets` — flatten.
      const { targets: _nested, ...flat } = override;
      targets[name as HarnessTarget] = flat;
    }
    out.targets = targets;
  }
  return out;
}

function parseRole(name: string, raw: unknown, path: string): Role {
  if (!ROLE_NAME_RE.test(name)) {
    throw new Error(
      `${path}: role name "${name}" is invalid — must match ${ROLE_NAME_RE} (lowercase, digits, hyphens; start with a letter)`,
    );
  }
  const base = parseProviderModel(raw, `roles.${name}`, path);
  const role: Role = { name, ...base };
  const fallbackRaw = (raw as Record<string, unknown>).fallback;
  if (fallbackRaw != null) {
    if (!Array.isArray(fallbackRaw)) {
      throw new Error(`${path}: roles.${name}.fallback must be an array`);
    }
    role.fallback = fallbackRaw.map((f, i) =>
      parseProviderModel(f, `roles.${name}.fallback[${i}]`, path),
    );
  }
  return role;
}

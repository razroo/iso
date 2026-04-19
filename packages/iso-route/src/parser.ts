import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import type { ModelPolicy, Provider, ProviderModel, Reasoning, Role } from "./types.js";

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
  "local",
]);

const VALID_REASONING: ReadonlySet<Reasoning> = new Set<Reasoning>(["low", "medium", "high"]);

const ROLE_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function loadPolicy(path: string): ModelPolicy {
  const sourcePath = resolve(path);
  const sourceDir = dirname(sourcePath);
  const raw = readFileSync(sourcePath, "utf8");
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: models file must be a YAML object`);
  }

  const def = parsed.default;
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    throw new Error(`${path}: "default" (object with provider + model) is required`);
  }
  const defaultModel = parseProviderModel(def, "default", path);

  const rolesRaw = parsed.roles;
  let roles: Role[] = [];
  if (rolesRaw != null) {
    if (typeof rolesRaw !== "object" || Array.isArray(rolesRaw)) {
      throw new Error(`${path}: "roles" must be an object mapping role-name → model config`);
    }
    roles = Object.entries(rolesRaw as Record<string, unknown>).map(([name, cfg]) =>
      parseRole(name, cfg, path),
    );
  }

  const seen = new Set<string>();
  for (const r of roles) {
    if (seen.has(r.name)) {
      throw new Error(`${path}: duplicate role "${r.name}"`);
    }
    seen.add(r.name);
  }

  return { default: defaultModel, roles, sourcePath, sourceDir };
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

export type Provider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "mistral"
  | "groq"
  | "ollama"
  | "openrouter"
  | "opencode"
  | "local";

export type Reasoning = "low" | "medium" | "high";

export type HarnessTarget = "claude" | "codex" | "opencode" | "cursor";

export interface ProviderModel {
  provider: Provider;
  model: string;
  reasoning?: Reasoning;
  /**
   * Per-harness overrides. When emitting for a given target, if
   * `targets[target]` is present, the emitter uses that instead of the
   * parent policy. The override is a full `ProviderModel` (provider + model
   * + optional reasoning) — any field can differ from the parent.
   *
   * Use this to express "Haiku on Claude Code, opencode/big-pickle on
   * OpenCode, gpt-5-mini on Codex" from a single role.
   */
  targets?: Partial<Record<HarnessTarget, TargetOverride>>;
}

/**
 * A per-harness override. Same shape as ProviderModel but the nested
 * `targets` field is not recursive — you cannot nest target overrides
 * inside target overrides.
 */
export interface TargetOverride {
  provider: Provider;
  model: string;
  reasoning?: Reasoning;
}

export interface Role extends ProviderModel {
  name: string;
  fallback?: ProviderModel[];
}

export interface ModelPolicy {
  default: ProviderModel;
  roles: Role[];
  sourcePath: string;
  sourceDir: string;
}

export interface EmittedFile {
  path: string;
  bytes: number;
  contents: string;
}

export interface EmitResult {
  target: HarnessTarget;
  files: EmittedFile[];
  warnings: string[];
}

export interface BuildResult {
  policy: ModelPolicy;
  emits: EmitResult[];
  warnings: string[];
}

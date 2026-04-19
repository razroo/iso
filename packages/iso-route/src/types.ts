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
  | "local";

export type Reasoning = "low" | "medium" | "high";

export interface ProviderModel {
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

export type HarnessTarget = "claude" | "codex" | "opencode" | "cursor";

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

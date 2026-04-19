import type { EmitResult, ModelPolicy, ProviderModel } from "../types.js";

const CONFIG_PATH = "opencode.json";

export function emitOpenCode(policy: ModelPolicy): EmitResult {
  const warnings: string[] = [];

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: qualifiedModel(policy.default),
  };

  if (policy.roles.length) {
    const agents: Record<string, unknown> = {};
    for (const role of policy.roles) {
      agents[role.name] = { model: qualifiedModel(role) };
      if (role.fallback?.length) {
        warnings.push(
          `opencode: role "${role.name}" fallback chain recorded in resolved map but OpenCode has no native fallback field`,
        );
      }
    }
    config.agent = agents;
  }

  const providerKeys = new Set<ProviderModel["provider"]>();
  for (const r of [policy.default, ...policy.roles]) providerKeys.add(r.provider);
  const providerEntries: Array<[string, { npm: string }]> = [];
  for (const p of providerKeys) {
    const pkg = providerPackage(p);
    // OpenCode natively recognises `opencode/*` routing tokens; no SDK
    // package to declare. Skip the provider block entry so opencode.json
    // doesn't try to install a nonexistent npm package.
    if (pkg === null) continue;
    providerEntries.push([p, { npm: pkg }]);
  }
  if (providerEntries.length) config.provider = Object.fromEntries(providerEntries);

  const json = `${JSON.stringify(config, null, 2)}\n`;
  return {
    target: "opencode",
    files: [{ path: CONFIG_PATH, bytes: Buffer.byteLength(json, "utf8"), contents: json }],
    warnings,
  };
}

function qualifiedModel(r: ProviderModel): string {
  // "opencode" is a passthrough — the model string is already a fully-
  // qualified OpenCode routing token (e.g. "opencode/big-pickle",
  // "opencode-go/minimax-m2.7"). Re-prefixing would double-qualify it.
  if (r.provider === "opencode") return r.model;
  return `${r.provider}/${r.model}`;
}

function providerPackage(p: ProviderModel["provider"]): string | null {
  switch (p) {
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "openai":
      return "@ai-sdk/openai";
    case "google":
      return "@ai-sdk/google";
    case "xai":
      return "@ai-sdk/xai";
    case "deepseek":
      return "@ai-sdk/deepseek";
    case "mistral":
      return "@ai-sdk/mistral";
    case "groq":
      return "@ai-sdk/groq";
    case "openrouter":
      return "@openrouter/ai-sdk-provider";
    case "ollama":
      return "ollama-ai-provider";
    case "local":
      return "ollama-ai-provider";
    case "opencode":
      return null;
  }
}

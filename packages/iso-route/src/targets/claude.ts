import type { EmitResult, ModelPolicy, ProviderModel } from "../types.js";

const SETTINGS_PATH = ".claude/settings.json";
const RESOLVED_PATH = ".claude/iso-route.resolved.json";

export function emitClaude(policy: ModelPolicy): EmitResult {
  const warnings: string[] = [];

  if (policy.default.provider !== "anthropic") {
    warnings.push(
      `claude: default.provider is "${policy.default.provider}" but Claude Code only runs Anthropic models — setting.json still written, but it will be ignored at runtime`,
    );
  }

  const settings: Record<string, unknown> = { model: policy.default.model };
  const settingsJson = `${JSON.stringify(settings, null, 2)}\n`;

  const resolved = {
    default: policy.default,
    roles: Object.fromEntries(
      policy.roles.map((r) => [
        r.name,
        {
          provider: r.provider,
          model: r.model,
          reasoning: r.reasoning,
          fallback: r.fallback,
        },
      ]),
    ),
  };
  const resolvedJson = `${JSON.stringify(resolved, null, 2)}\n`;

  for (const role of policy.roles) {
    if (role.provider !== "anthropic") {
      warnings.push(
        `claude: role "${role.name}" uses provider "${role.provider}" — Claude Code subagents only support Anthropic models. iso-harness will skip model frontmatter for this role.`,
      );
    }
    if (role.fallback?.length) {
      warnings.push(
        `claude: role "${role.name}" has a fallback chain, but Claude Code does not support runtime fallback — only the primary will be used`,
      );
    }
  }

  return {
    target: "claude",
    files: [
      file(SETTINGS_PATH, settingsJson),
      file(RESOLVED_PATH, resolvedJson),
    ],
    warnings,
  };
}

function file(path: string, contents: string) {
  return { path, bytes: Buffer.byteLength(contents, "utf8"), contents };
}

export function claudeModelFor(role: { provider: string; model: string } | ProviderModel): string | null {
  return role.provider === "anthropic" ? role.model : null;
}

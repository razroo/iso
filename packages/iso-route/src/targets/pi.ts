import type { EmitResult, ModelPolicy, ProviderModel } from "../types.js";

const SETTINGS_PATH = ".pi/settings.json";
const NOTE_PATH = ".pi/iso-route.md";

export function emitPi(policy: ModelPolicy): EmitResult {
  const warnings: string[] = [];
  const settings: Record<string, unknown> = {
    defaultProvider: policy.default.provider,
    defaultModel: policy.default.model,
  };
  if (policy.default.reasoning) settings.defaultThinkingLevel = policy.default.reasoning;

  const enabledModels = uniqueModels([policy.default, ...policy.roles]);
  if (enabledModels.length) settings.enabledModels = enabledModels;

  if (policy.roles.length) {
    warnings.push(
      "pi: role-specific models are emitted as .pi/iso-route.md notes and enabledModels only — Pi has no native role/subagent model binding",
    );
  }
  for (const role of policy.roles) {
    if (role.fallback?.length) {
      warnings.push(
        `pi: role "${role.name}" fallback chain recorded in notes but not encoded in settings.json`,
      );
    }
  }

  const settingsJson = `${JSON.stringify(settings, null, 2)}\n`;
  const note = renderNote(policy);

  return {
    target: "pi",
    files: [
      file(SETTINGS_PATH, settingsJson),
      file(NOTE_PATH, note),
    ],
    warnings,
  };
}

function uniqueModels(models: ProviderModel[]): string[] {
  const seen = new Set<string>();
  for (const m of models) {
    if (m.model) seen.add(m.model);
  }
  return [...seen];
}

function renderNote(policy: ModelPolicy): string {
  const lines: string[] = [
    "# iso-route — Pi notes",
    "",
    "Pi reads `.pi/settings.json` for the default provider/model and model cycling. It does not have native role-specific subagent binding, so role entries below are advisory for manual model switching or extension/package workflows.",
    "",
    "## Default",
    "",
    `- **${policy.default.provider} / ${policy.default.model}**${
      policy.default.reasoning ? ` — thinking: ${policy.default.reasoning}` : ""
    }`,
    "",
  ];
  if (policy.roles.length) {
    lines.push("## Roles");
    lines.push("");
    lines.push("| Role | Provider | Model | Thinking | Fallback |");
    lines.push("| ---- | -------- | ----- | -------- | -------- |");
    for (const role of policy.roles) {
      const fallback = role.fallback?.length
        ? role.fallback.map((f) => `${f.provider}/${f.model}`).join(" -> ")
        : "-";
      lines.push(
        `| \`${role.name}\` | ${role.provider} | \`${role.model}\` | ${role.reasoning ?? "-"} | ${fallback} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function file(path: string, contents: string) {
  return { path, bytes: Buffer.byteLength(contents, "utf8"), contents };
}

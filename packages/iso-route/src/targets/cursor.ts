import type { EmitResult, ModelPolicy } from "../types.js";

const NOTE_PATH = ".cursor/iso-route.md";

export function emitCursor(policy: ModelPolicy): EmitResult {
  const warnings: string[] = [
    "cursor: has no programmatic model binding — model is picked from the UI per chat. iso-route emits a README note only; users must select models manually.",
  ];

  const lines: string[] = [
    "# iso-route — Cursor notes",
    "",
    "Cursor does not expose a file-based way to pin which model it uses, so iso-route can't emit a settings file here the way it does for Claude Code, Codex, or OpenCode. Use this file as the team-shared record of *which models you should pick from the Cursor chat selector* to stay consistent with the rest of your harness.",
    "",
    "## Default",
    "",
    `- **${policy.default.provider} / ${policy.default.model}**${
      policy.default.reasoning ? ` — reasoning: ${policy.default.reasoning}` : ""
    }`,
    "",
  ];
  if (policy.roles.length) {
    lines.push("## Roles");
    lines.push("");
    lines.push("Cursor has no role/subagent system, so these are advisory — switch the model picker before invoking the chat for that kind of work.");
    lines.push("");
    lines.push("| Role | Provider | Model | Reasoning |");
    lines.push("| ---- | -------- | ----- | --------- |");
    for (const r of policy.roles) {
      lines.push(
        `| \`${r.name}\` | ${r.provider} | \`${r.model}\` | ${r.reasoning ?? "—"} |`,
      );
    }
    lines.push("");
  }
  const contents = lines.join("\n");
  return {
    target: "cursor",
    files: [{ path: NOTE_PATH, bytes: Buffer.byteLength(contents, "utf8"), contents }],
    warnings,
  };
}

import type {
  CapabilityCheckResult,
  CapabilityIssue,
  RenderTarget,
  ResolvedCapabilityRole,
} from "./types.js";

export function formatResolvedRole(role: ResolvedCapabilityRole): string {
  const lines = [`${role.name}`];
  if (role.description) lines.push(role.description);
  if (role.extends.length) lines.push(`extends: ${role.extends.join(", ")}`);
  lines.push("");
  lines.push("capabilities:");
  lines.push(`  tools: ${list(role.tools)}`);
  lines.push(`  mcp: ${list(role.mcp)}`);
  lines.push(`  commands.allow: ${list(role.commands.allow)}`);
  lines.push(`  commands.deny: ${list(role.commands.deny)}`);
  lines.push(`  filesystem: ${role.filesystem}`);
  lines.push(`  network: ${role.network}`);
  if (role.notes.length) {
    lines.push("");
    lines.push("notes:");
    for (const note of role.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

export function renderRole(role: ResolvedCapabilityRole, target: RenderTarget): string {
  if (target === "json") return JSON.stringify(role, null, 2);

  const targetName = target === "markdown" ? "generic agent" : target;
  const lines = [
    `# ${role.name} capability policy`,
    "",
    `Target: ${targetName}`,
  ];
  if (role.description) lines.push("", role.description);
  lines.push("");
  lines.push("Allow this role only the following local capabilities:");
  lines.push(`- Tools: ${list(role.tools)}`);
  lines.push(`- MCP servers: ${list(role.mcp)}`);
  lines.push(`- Commands allowlist: ${list(role.commands.allow)}`);
  lines.push(`- Commands denylist: ${list(role.commands.deny)}`);
  lines.push(`- Filesystem mode: ${role.filesystem}`);
  lines.push(`- Network mode: ${role.network}`);
  if (role.notes.length) {
    lines.push("");
    lines.push("Operational notes:");
    for (const note of role.notes) lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("Where the target harness cannot enforce a field natively, keep this as auditable policy and verify behavior with iso-trace/iso-guard.");
  return lines.join("\n");
}

export function formatCheckResult(result: CapabilityCheckResult): string {
  const lines = [
    `iso-capabilities: ${result.ok ? "PASS" : "FAIL"} ${result.role.name} (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"})`,
  ];
  for (const issue of result.issues) lines.push(`  ${formatIssue(issue)}`);
  return lines.join("\n");
}

export function formatIssue(issue: CapabilityIssue): string {
  const matched = issue.matched ? ` matched=${issue.matched}` : "";
  return `${issue.kind}: ${issue.message}${matched}`;
}

function list(values: string[]): string {
  return values.length ? values.join(", ") : "(none)";
}

import type { AuditResult, GuardPolicy, GuardRule } from "./types.js";

export type FailOn = "error" | "warn" | "off";

export function resultFails(result: AuditResult, failOn: FailOn): boolean {
  if (failOn === "off") return false;
  if (failOn === "warn") return result.errors > 0 || result.warnings > 0;
  return result.errors > 0;
}

export function formatAuditResult(result: AuditResult): string {
  if (result.violations.length === 0) {
    return `iso-guard: PASS (${result.ruleCount} rules, ${result.eventCount} events)`;
  }

  const lines = [
    `iso-guard: ${result.errors > 0 ? "FAIL" : "WARN"} (${result.errors} errors, ${result.warnings} warnings, ${result.ruleCount} rules, ${result.eventCount} events)`,
  ];
  for (const violation of result.violations) {
    lines.push(`[${violation.severity}] ${violation.ruleId}: ${violation.message}`);
  }
  return lines.join("\n");
}

export function formatPolicyExplanation(policy: GuardPolicy): string {
  const lines = [
    `iso-guard policy: ${policy.sourcePath ?? "<inline>"}`,
    `rules: ${policy.rules.length}`,
  ];
  for (const rule of policy.rules) {
    lines.push(`- ${rule.id}: ${rule.type}${rule.description ? ` — ${rule.description}` : ""}`);
    const summary = summarizeRule(rule);
    if (summary) lines.push(`  ${summary}`);
  }
  return lines.join("\n");
}

function summarizeRule(rule: GuardRule): string {
  switch (rule.type) {
    case "max-per-group":
      return `max ${rule.max} per ${rule.groupBy ?? "all events"}`;
    case "require-before":
      return `requires one matching event before each trigger${rule.groupBy ? ` in group ${rule.groupBy}` : ""}`;
    case "require-after":
      return `requires ${rule.require.length} follow-up event(s) after the last trigger`;
    case "forbid-text":
      return `forbids ${rule.patterns.length} text pattern(s)`;
    case "no-overlap":
      return `prevents overlapping starts with the same ${rule.keyBy}`;
  }
}

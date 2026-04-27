import { listRedactRules } from "./redact.js";
import type { RedactConfig, RedactFinding, RedactScanResult, RedactSeverity } from "./types.js";

export function formatScanResult(result: RedactScanResult, mode: "scan" | "verify" = "scan"): string {
  const verb = mode === "verify" ? (result.ok ? "PASS" : "FAIL") : (result.ok ? "CLEAN" : "FOUND");
  const lines = [
    `iso-redact: ${verb}`,
    `sources: ${result.totals.sources}`,
    `findings: ${result.totals.findings}`,
    `severity: error=${result.totals.bySeverity.error}, warn=${result.totals.bySeverity.warn}, info=${result.totals.bySeverity.info}`,
  ];

  const ruleCounts = Object.entries(result.totals.byRule).sort(([a], [b]) => a.localeCompare(b));
  if (ruleCounts.length) {
    lines.push("rules:");
    for (const [rule, count] of ruleCounts) lines.push(`  - ${rule}: ${count}`);
  }

  if (result.findings.length) {
    lines.push("findings:");
    for (const finding of result.findings) lines.push(`  - ${formatFinding(finding)}`);
  }

  return lines.join("\n");
}

export function formatConfigSummary(config: RedactConfig): string {
  const rules = listRedactRules(config);
  const byKind = countBy(rules.map((rule) => rule.kind));
  const bySeverity = countBy(rules.map((rule) => rule.severity));
  const lines = [
    `iso-redact config: ${rules.length} rule(s)`,
    `kinds: builtin=${byKind.builtin ?? 0}, pattern=${byKind.pattern ?? 0}, field=${byKind.field ?? 0}`,
    `severity: error=${bySeverity.error ?? 0}, warn=${bySeverity.warn ?? 0}, info=${bySeverity.info ?? 0}`,
  ];
  if (rules.length) {
    lines.push("rules:");
    for (const rule of rules) lines.push(`  - ${rule.id} (${rule.kind}, ${rule.severity}) -> ${rule.replacement}`);
  }
  return lines.join("\n");
}

function formatFinding(finding: RedactFinding): string {
  return `${finding.source}:${finding.line}:${finding.column} ${finding.ruleId} (${finding.kind}, ${finding.severity}) ${finding.preview}`;
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

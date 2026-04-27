import type { FactCheckResult, FactConfig, FactRecord, FactSet, FactVerifyResult } from "./types.js";

export function formatBuildResult(factSet: FactSet, outPath: string): string {
  return [
    `iso-facts: BUILT ${factSet.facts.length} facts from ${factSet.stats.files} files`,
    `out: ${outPath}`,
    `root: ${factSet.root}`,
  ].join("\n");
}

export function formatFacts(facts: FactRecord[]): string {
  if (!facts.length) return "iso-facts: no facts";
  return facts.map(formatFact).join("\n");
}

export function formatFact(fact: FactRecord): string {
  const key = fact.key ? ` key=${fact.key}` : "";
  const value = fact.value ? ` value=${fact.value}` : "";
  const tags = fact.tags.length ? ` tags=${fact.tags.join(",")}` : "";
  const pointer = fact.source.pointer ? fact.source.pointer : "";
  return `${fact.fact}${key}${value} @ ${fact.source.path}:${fact.source.line}${pointer}${tags}`;
}

export function formatVerifyResult(result: FactVerifyResult): string {
  const lines = [`iso-facts: ${result.ok ? "PASS" : "FAIL"} (${result.facts} facts)`];
  if (result.issues.length) {
    lines.push("");
    lines.push("issues:");
    for (const issue of result.issues) {
      const fact = issue.factId ? ` ${issue.factId}` : "";
      lines.push(`  ${issue.severity} ${issue.kind}${fact}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function formatCheckResult(result: FactCheckResult): string {
  const lines = [`iso-facts: ${result.ok ? "PASS" : "FAIL"} (${result.requirements} requirement(s), ${result.facts} facts)`];
  if (result.issues.length) {
    lines.push("");
    lines.push("issues:");
    for (const issue of result.issues) {
      const key = issue.requirement.key ? ` key=${issue.requirement.key}` : "";
      const source = issue.requirement.source ? ` source=${issue.requirement.source}` : "";
      const tag = issue.requirement.tag ? ` tag=${issue.requirement.tag}` : "";
      lines.push(`  ${issue.severity} ${issue.kind}: ${issue.message}${key}${source}${tag}`);
    }
  }
  return lines.join("\n");
}

export function formatConfigSummary(config: FactConfig): string {
  const lines = [`iso-facts config: ${config.sources.length} source(s), ${config.requirements?.length || 0} requirement(s)`];
  for (const source of config.sources) {
    const format = source.format || "text";
    const ruleCount = (source.rules?.length || 0) + (source.records?.length || 0);
    lines.push(`- ${source.name}: ${format}, ${source.include.length} include(s), ${ruleCount} rule(s)`);
  }
  return lines.join("\n");
}

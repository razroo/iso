import type { ArtifactIndex, IndexConfig, IndexRecord, IndexVerifyResult } from "./types.js";

export function formatBuildResult(index: ArtifactIndex, outPath: string): string {
  return [
    `iso-index: BUILT ${index.records.length} records from ${index.stats.files} files`,
    `out: ${outPath}`,
    `root: ${index.root}`,
  ].join("\n");
}

export function formatIndexRecords(records: IndexRecord[]): string {
  if (!records.length) return "iso-index: no records";
  return records.map(formatIndexRecord).join("\n");
}

export function formatIndexRecord(record: IndexRecord): string {
  const value = record.value ? ` value=${record.value}` : "";
  const tags = record.tags.length ? ` tags=${record.tags.join(",")}` : "";
  return `${record.kind} ${record.key}${value} @ ${record.source.path}:${record.source.line}${tags}`;
}

export function formatVerifyResult(result: IndexVerifyResult): string {
  const lines = [`iso-index: ${result.ok ? "PASS" : "FAIL"} (${result.records} records)`];
  if (result.issues.length) {
    lines.push("");
    lines.push("issues:");
    for (const issue of result.issues) {
      const record = issue.recordId ? ` ${issue.recordId}` : "";
      lines.push(`  ${issue.severity} ${issue.kind}${record}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function formatConfigSummary(config: IndexConfig): string {
  const lines = [`iso-index config: ${config.sources.length} source(s)`];
  for (const source of config.sources) {
    const format = source.format || "text";
    const ruleCount = (source.rules?.length || 0) + (source.records?.length || 0);
    lines.push(`- ${source.name}: ${format}, ${source.include.length} include(s), ${ruleCount} rule(s)`);
  }
  return lines.join("\n");
}

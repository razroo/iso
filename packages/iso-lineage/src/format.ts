import type { LineageCheckResult, LineageGraph, LineageRecord, LineageVerifyResult } from "./types.js";

export function formatRecordResult(graph: LineageGraph, record: LineageRecord, graphPath: string): string {
  return [
    `iso-lineage: RECORDED ${record.artifact.path} inputs=${record.inputs.length}`,
    `graph: ${graphPath}`,
    `record: ${record.id}`,
    `graphId: ${graph.id}`,
  ].join("\n");
}

export function formatCheckResult(result: LineageCheckResult): string {
  const lines = [
    `iso-lineage: ${result.ok ? "PASS" : "STALE"} graph=${result.graphId} total=${result.total} current=${result.current} stale=${result.stale} missing=${result.missing}`,
  ];
  for (const record of result.records.filter((item) => item.state !== "current")) {
    lines.push(`- ${record.state.toUpperCase()} ${record.record.artifact.path}`);
    for (const issue of record.issues) {
      lines.push(`  ${issue.code}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function formatStaleResult(result: LineageCheckResult): string {
  if (result.ok) return `iso-lineage: CLEAN graph=${result.graphId} records=${result.total}`;
  return formatCheckResult(result);
}

export function formatVerifyResult(result: LineageVerifyResult): string {
  const lines = [`iso-lineage: ${result.ok ? "PASS" : "FAIL"} errors=${result.errors} warnings=${result.warnings}`];
  for (const issue of result.issues) lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  return lines.join("\n");
}

export function formatExplainGraph(graph: LineageGraph, artifact?: string): string {
  const records = artifact ? graph.records.filter((record) => record.artifact.path === artifact) : graph.records;
  const lines = [`iso-lineage graph: ${graph.id}`, `records: ${records.length}/${graph.records.length}`];
  for (const record of records) {
    lines.push(`- ${record.artifact.path} (${record.artifact.kind || "artifact"})`);
    lines.push(`  id: ${record.id}`);
    if (record.command) lines.push(`  command: ${record.command}`);
    if (record.createdAt) lines.push(`  createdAt: ${record.createdAt}`);
    lines.push(`  inputs: ${record.inputs.length}`);
    for (const input of record.inputs) {
      lines.push(`    - ${input.path}${input.optional ? " (optional)" : ""}${input.missing ? " [missing when recorded]" : ""}`);
    }
  }
  return lines.join("\n");
}

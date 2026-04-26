import type { LedgerEvent, MaterializedLedger, VerifyResult } from "./types.js";

export function formatVerifyResult(result: VerifyResult): string {
  if (result.issues.length === 0) {
    return `iso-ledger: PASS (${result.eventCount} events)`;
  }
  const lines = [
    `iso-ledger: ${result.errors > 0 ? "FAIL" : "WARN"} (${result.errors} errors, ${result.warnings} warnings, ${result.eventCount} events)`,
  ];
  for (const issue of result.issues) {
    const location = issue.line ? ` line ${issue.line}` : "";
    lines.push(`[${issue.severity}] ${issue.code}${location}: ${issue.message}`);
  }
  return lines.join("\n");
}

export function formatEvents(events: LedgerEvent[]): string {
  if (events.length === 0) return "iso-ledger: 0 event(s)";
  return events.map((event) => [
    event.id,
    event.at,
    event.type,
    event.key ?? "-",
    event.subject ?? "-",
  ].join("\t")).join("\n");
}

export function formatMaterializedLedger(view: MaterializedLedger): string {
  return `iso-ledger: materialized ${view.entityCount} entity/entities from ${view.eventCount} event(s)`;
}

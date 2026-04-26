import type { MigrationConfig, MigrationOperation, MigrationRunResult, OperationResult } from "./types.js";

export function formatMigrationResult(result: MigrationRunResult, mode: "plan" | "apply" | "check" = "plan"): string {
  const verb = mode === "apply" ? "APPLIED" : mode === "check" ? (result.changed ? "PENDING" : "PASS") : "PLAN";
  const lines = [
    `iso-migrate: ${verb} ${result.changeCount} change(s)`,
    `root: ${result.root}`,
  ];
  const operations = result.migrations.flatMap((migration) => migration.operations);
  if (operations.length) {
    lines.push("");
    for (const operation of operations) lines.push(formatOperationResult(operation));
  }
  return lines.join("\n");
}

export function formatOperationResult(result: OperationResult): string {
  const status = result.changed ? "change" : "ok";
  return `${status} ${result.migrationId} ${result.type} ${result.path}: ${result.message}`;
}

export function formatConfigSummary(config: MigrationConfig): string {
  const lines = [`iso-migrate config: ${config.migrations.length} migration(s)`];
  for (const migration of config.migrations) {
    const description = migration.description ? ` — ${migration.description}` : "";
    lines.push(`- ${migration.id}${description}`);
    for (const operation of migration.operations) {
      lines.push(`  - ${formatOperationSummary(operation)}`);
    }
  }
  return lines.join("\n");
}

export function formatOperationSummary(operation: MigrationOperation): string {
  if (operation.type === "ensure-lines") return `ensure-lines ${operation.path} (${operation.lines.length} line(s))`;
  if (operation.type === "json-set") return `json-set ${operation.path} ${operation.pointer || "/"}`;
  if (operation.type === "json-merge") return `json-merge ${operation.path} ${operation.pointer || "/"}`;
  if (operation.type === "replace") return `replace ${operation.path}`;
  if (operation.type === "write-file") return `write-file ${operation.path}`;
  const fallback = operation as unknown as { type?: string; path?: string };
  return `${fallback.type || "unknown"} ${fallback.path || ""}`;
}

import type { ContractDefinition, ContractIssue, ValidationResult } from "./types.js";

export function formatValidationResult(contract: ContractDefinition, result: ValidationResult): string {
  const lines = [
    `iso-contract: ${result.ok ? "PASS" : "FAIL"} ${contract.name} (${result.errors} errors, ${result.warnings} warnings)`,
  ];
  for (const issue of result.issues) lines.push(`  ${formatIssue(issue)}`);
  return lines.join("\n");
}

export function formatIssue(issue: ContractIssue): string {
  const field = issue.field ? `${issue.field}: ` : "";
  return `${issue.severity.toUpperCase()} ${issue.code}: ${field}${issue.message}`;
}

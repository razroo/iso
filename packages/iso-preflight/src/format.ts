import type { PreflightCandidatePlan, PreflightConfig, PreflightPlanResult, PreflightStep } from "./types.js";

export function formatPreflightPlan(result: PreflightPlanResult, mode: "plan" | "check" = "plan"): string {
  const verb = mode === "check" ? (result.ok ? "PASS" : "FAIL") : "PLAN";
  const lines = [
    `iso-preflight: ${verb} workflow=${result.workflow.name}`,
    `candidates: ${result.totals.ready} ready, ${result.totals.skipped} skipped, ${result.totals.blocked} blocked, ${result.totals.rounds} round(s)`,
  ];

  if (result.preSteps.length) {
    lines.push("pre:");
    lines.push(...result.preSteps.map(formatStep));
  }

  if (result.rounds.length) {
    lines.push("rounds:");
    for (const round of result.rounds) {
      lines.push(`  ${round.index}. ${round.candidates.map((candidate) => candidate.id).join(", ")}`);
    }
  }

  if (result.skipped.length) {
    lines.push("skipped:");
    lines.push(...result.skipped.map(formatCandidateIssueSummary));
  }

  if (result.blocked.length) {
    lines.push("blocked:");
    lines.push(...result.blocked.map(formatCandidateIssueSummary));
  }

  if (result.postSteps.length) {
    lines.push("post:");
    lines.push(...result.postSteps.map(formatStep));
  }

  return lines.join("\n");
}

export function formatConfigSummary(config: PreflightConfig): string {
  const lines = [`iso-preflight config: ${config.workflows.length} workflow(s)`];
  for (const workflow of config.workflows) {
    lines.push(`- ${workflow.name}`);
    lines.push(`  round size: ${workflow.roundSize}`);
    if (workflow.conflictFact) lines.push(`  conflict fact: ${workflow.conflictFact}`);
    if (workflow.requiredFacts.length) lines.push(`  required facts: ${workflow.requiredFacts.join(", ")}`);
    if (workflow.sourceRequiredFacts?.length) lines.push(`  source-required facts: ${workflow.sourceRequiredFacts.join(", ")}`);
    if (workflow.preSteps?.length) lines.push(`  pre steps: ${workflow.preSteps.map((step) => step.id).join(", ")}`);
    if (workflow.postSteps?.length) lines.push(`  post steps: ${workflow.postSteps.map((step) => step.id).join(", ")}`);
  }
  return lines.join("\n");
}

function formatStep(step: PreflightStep): string {
  return `  - ${step.id}: ${step.command || step.label}`;
}

function formatCandidateIssueSummary(candidate: PreflightCandidatePlan): string {
  const summary = candidate.issues.map((issue) => {
    const source = issue.source ? ` @ ${issue.source}` : "";
    return `${issue.message}${source}`;
  }).join("; ");
  return `  - ${candidate.id}: ${summary}`;
}

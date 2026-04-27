import type { PostflightConfig, PostflightResult, PostflightRoundResult, PostflightStepResult } from "./types.js";

export function formatPostflightResult(result: PostflightResult, mode: "status" | "check" = "status"): string {
  const verb = mode === "check" ? (result.ok ? "PASS" : "FAIL") : "STATUS";
  const lines = [
    `iso-postflight: ${verb} workflow=${result.workflow.name}`,
    `state: ${result.state}`,
    `next: ${result.nextAction.kind} - ${result.nextAction.message}`,
    `rounds: ${result.totals.completeRounds} complete, ${result.totals.notStartedRounds} not-started`,
    `outcomes: ${result.totals.succeeded} succeeded, ${result.totals.failed} failed, ${result.totals.skipped} skipped, ${result.totals.replacement} replacement, ${result.totals.inFlight} in-flight, ${result.totals.missing} missing, ${result.totals.blocked} blocked`,
  ];

  if (result.rounds.length) {
    lines.push("round details:");
    lines.push(...result.rounds.map(formatRound));
  }

  if (result.postSteps.length) {
    lines.push("post:");
    lines.push(...result.postSteps.map(formatStep));
  }

  if (result.issues.length) {
    lines.push("issues:");
    for (const issue of result.issues) {
      const parts = [
        issue.candidateId ? `candidate=${issue.candidateId}` : undefined,
        issue.round ? `round=${issue.round}` : undefined,
        issue.artifact ? `artifact=${issue.artifact}` : undefined,
        issue.step ? `step=${issue.step}` : undefined,
        issue.source ? `source=${issue.source}` : undefined,
      ].filter(Boolean);
      lines.push(`  - ${issue.kind}: ${issue.message}${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }
  }

  return lines.join("\n");
}

export function formatConfigSummary(config: PostflightConfig): string {
  const lines = [`iso-postflight config: ${config.workflows.length} workflow(s)`];
  for (const workflow of config.workflows) {
    lines.push(`- ${workflow.name}`);
    lines.push(`  terminal statuses: ${workflow.terminalStatuses.join(", ")}`);
    lines.push(`  replacement statuses: ${workflow.replacementStatuses.join(", ") || "(none)"}`);
    if (workflow.requiredArtifacts.length) lines.push(`  required artifacts: ${workflow.requiredArtifacts.map((artifact) => artifact.id).join(", ")}`);
    if (workflow.postSteps.length) lines.push(`  post steps: ${workflow.postSteps.map((step) => step.id).join(", ")}`);
  }
  return lines.join("\n");
}

function formatRound(round: PostflightRoundResult): string {
  const candidates = round.candidates.map((candidate) => {
    const status = candidate.status ? `:${candidate.status}` : "";
    return `${candidate.id}=${candidate.state}${status}`;
  }).join(", ");
  return `  ${round.index}. ${round.state}: ${candidates}`;
}

function formatStep(step: PostflightStepResult): string {
  const source = step.source ? ` @ ${step.source}` : "";
  return `  - ${step.id}: ${step.state}${step.status ? ` (${step.status})` : ""}${source}`;
}

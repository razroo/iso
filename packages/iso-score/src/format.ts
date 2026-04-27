import type {
  CheckScoreResult,
  EvaluateGateResult,
  ScoreComparison,
  ScoreConfig,
  ScoreResult,
  ScoreVerifyResult,
} from "./types.js";

export function formatScoreResult(result: ScoreResult): string {
  const subject = result.subject ? ` subject="${result.subject}"` : "";
  const band = result.band ? ` band=${result.band.id}` : "";
  const lines = [
    `iso-score: SCORED profile=${result.profile}${subject} score=${result.score}/${result.maxScore}${band}`,
  ];
  if (result.dimensions.length) {
    lines.push("dimensions:");
    for (const dimension of result.dimensions) {
      const evidence = dimension.evidence.length ? ` evidence=${dimension.evidence.length}` : "";
      lines.push(`  - ${dimension.id}: score=${dimension.score} weight=${dimension.weight} contribution=${dimension.weighted}${evidence}`);
    }
  }
  if (result.gates.length) {
    lines.push("gates:");
    for (const gate of result.gates) {
      lines.push(`  - ${gate.id}: ${gate.pass ? "PASS" : "FAIL"} (${gate.reason})`);
    }
  }
  if (result.issues.length) {
    lines.push("issues:");
    for (const issue of result.issues) {
      const target = issue.dimension ? ` dimension=${issue.dimension}` : issue.gate ? ` gate=${issue.gate}` : "";
      lines.push(`  - ${issue.severity.toUpperCase()} ${issue.code}${target}: ${issue.message}`);
    }
  }
  return lines.join("\n");
}

export function formatCheckResult(check: CheckScoreResult): string {
  const lines = [
    `iso-score: ${check.ok ? "PASS" : "FAIL"} profile=${check.result.profile} score=${check.result.score}/${check.result.maxScore}`,
  ];
  if (check.result.gates.length) {
    lines.push(...check.result.gates.map((gate) => `gate ${gate.id}: ${gate.pass ? "PASS" : "FAIL"} (${gate.reason})`));
  }
  if (check.issues.length) {
    lines.push(...check.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`));
  }
  return lines.join("\n");
}

export function formatGateResult(result: EvaluateGateResult): string {
  return [
    `iso-score: ${result.ok ? "PASS" : "FAIL"} gate=${result.gate.id} score=${result.result.score}/${result.result.maxScore}`,
    result.gate.reason,
  ].join("\n");
}

export function formatVerifyResult(result: ScoreVerifyResult): string {
  const lines = [`iso-score: ${result.ok ? "PASS" : "FAIL"} errors=${result.errors} warnings=${result.warnings}`];
  if (result.issues.length) {
    lines.push(...result.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`));
  }
  return lines.join("\n");
}

export function formatComparison(comparison: ScoreComparison): string {
  return [
    `iso-score: WINNER ${comparison.winner} delta=${comparison.delta}`,
    `left: ${comparison.left.score}/${comparison.left.maxScore} (${comparison.left.band?.id || "no-band"})`,
    `right: ${comparison.right.score}/${comparison.right.maxScore} (${comparison.right.band?.id || "no-band"})`,
    comparison.reason,
  ].join("\n");
}

export function formatConfigSummary(config: ScoreConfig, profileName?: string): string {
  const profiles = profileName ? config.profiles.filter((profile) => profile.name === profileName) : config.profiles;
  if (profileName && profiles.length === 0) throw new Error(`profile "${profileName}" not found`);
  const lines = [`iso-score config: ${profiles.length} profile(s)`];
  for (const profile of profiles) {
    const scale = profile.scale || { min: 0, max: 5, precision: 2 };
    lines.push(`- ${profile.name}`);
    lines.push(`  scale: ${scale.min}-${scale.max}`);
    lines.push(`  dimensions: ${profile.dimensions.map((dimension) => `${dimension.id}:${dimension.weight ?? 1}`).join(", ")}`);
    if (profile.bands?.length) lines.push(`  bands: ${profile.bands.map((band) => `${band.id}>=${band.min}`).join(", ")}`);
    if (profile.gates?.length) lines.push(`  gates: ${profile.gates.map((gate) => gate.id).join(", ")}`);
  }
  return lines.join("\n");
}

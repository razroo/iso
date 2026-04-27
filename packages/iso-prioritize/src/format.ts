import type {
  PrioritizeCheckResult,
  PrioritizeConfig,
  PrioritizedItem,
  PrioritizeResult,
  PrioritizeVerifyResult,
} from "./types.js";

export function formatPrioritizeResult(result: PrioritizeResult): string {
  const lines = [
    `iso-prioritize: RANK profile=${result.profile} total=${result.stats.total} selected=${result.stats.selected} candidate=${result.stats.candidate} skipped=${result.stats.skipped} blocked=${result.stats.blocked}`,
    `limit: ${result.limit}`,
  ];
  if (result.items.length) {
    lines.push("items:");
    for (const item of result.items) lines.push(formatItem(item));
  }
  if (result.issues.length) {
    lines.push("issues:");
    for (const issue of result.issues) lines.push(`  - ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  }
  return lines.join("\n");
}

export function formatCheckResult(result: PrioritizeCheckResult): string {
  const lines = [
    `iso-prioritize: ${result.ok ? "PASS" : "FAIL"} profile=${result.result.profile} selected=${result.result.stats.selected} minSelected=${result.minSelected} failOn=${result.failOn.join(",") || "none"}`,
  ];
  const selected = result.result.items.filter((item) => item.state === "selected");
  if (selected.length) {
    lines.push("selected:");
    for (const item of selected) lines.push(formatItem(item));
  }
  if (result.issues.length) {
    lines.push(...result.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`));
  }
  return lines.join("\n");
}

export function formatVerifyResult(result: PrioritizeVerifyResult): string {
  const lines = [`iso-prioritize: ${result.ok ? "PASS" : "FAIL"} errors=${result.errors} warnings=${result.warnings}`];
  if (result.issues.length) {
    lines.push(...result.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`));
  }
  return lines.join("\n");
}

export function formatConfigSummary(config: PrioritizeConfig, profileName?: string): string {
  const profiles = profileName
    ? config.profiles.filter((profile) => profile.name === profileName)
    : config.profiles;
  const lines = [`iso-prioritize config: ${config.profiles.length} profile(s)`];
  if (config.defaults?.profile) lines.push(`default profile: ${config.defaults.profile}`);
  if (config.defaults?.limit) lines.push(`default limit: ${config.defaults.limit}`);
  for (const profile of profiles) {
    lines.push(`- ${profile.name}`);
    if (profile.description) lines.push(`  description: ${profile.description}`);
    if (profile.limit) lines.push(`  limit: ${profile.limit}`);
    lines.push(`  criteria: ${profile.criteria.map((criterion) => `${criterion.id}:${criterion.weight}`).join(", ")}`);
    if (profile.gates?.length) lines.push(`  gates: ${profile.gates.map((gate) => `${gate.id}:${gate.action}`).join(", ")}`);
    if (profile.adjustments?.length) lines.push(`  adjustments: ${profile.adjustments.map((adjustment) => `${adjustment.id}:${adjustment.value}`).join(", ")}`);
    if (profile.quotas?.length) lines.push(`  quotas: ${profile.quotas.map((quota) => `${quota.id}:${quota.field}<=${quota.max}`).join(", ")}`);
  }
  return lines.join("\n");
}

function formatItem(item: PrioritizedItem): string {
  const prefix = item.rank ? `#${item.rank}` : "-";
  const label = item.title || item.key || item.id;
  return `  ${prefix} ${item.state.toUpperCase()} ${label} score=${item.score}${item.key ? ` key=${item.key}` : ""}`;
}

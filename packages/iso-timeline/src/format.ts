import type {
  TimelineCheckResult,
  TimelineConfig,
  TimelineItem,
  TimelineResult,
  TimelineVerifyResult,
} from "./types.js";

export function formatTimelineResult(result: TimelineResult): string {
  const lines = [
    `iso-timeline: PLAN total=${result.stats.total} due=${result.stats.due} overdue=${result.stats.overdue} upcoming=${result.stats.upcoming} blocked=${result.stats.blocked} suppressed=${result.stats.suppressed}`,
    `now: ${result.now}`,
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

export function formatCheckResult(result: TimelineCheckResult): string {
  const lines = [
    `iso-timeline: ${result.ok ? "PASS" : "FAIL"} failOn=${result.failOn.join(",") || "none"} due=${result.result.stats.due} overdue=${result.result.stats.overdue}`,
  ];
  const actionable = result.result.items.filter((item) => item.state === "due" || item.state === "overdue");
  if (actionable.length) {
    lines.push("actions:");
    for (const item of actionable) lines.push(formatItem(item));
  }
  if (result.issues.length) {
    lines.push(...result.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`));
  }
  return lines.join("\n");
}

export function formatVerifyResult(result: TimelineVerifyResult): string {
  const lines = [`iso-timeline: ${result.ok ? "PASS" : "FAIL"} errors=${result.errors} warnings=${result.warnings}`];
  if (result.issues.length) {
    lines.push(...result.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`));
  }
  return lines.join("\n");
}

export function formatConfigSummary(config: TimelineConfig): string {
  const lines = [`iso-timeline config: ${config.rules.length} rule(s)`];
  if (config.defaults?.now) lines.push(`default now: ${config.defaults.now}`);
  if (config.defaults?.overdueAfter) lines.push(`default overdueAfter: ${formatDuration(config.defaults.overdueAfter)}`);
  for (const rule of config.rules) {
    lines.push(`- ${rule.id}: action=${rule.action} after=${formatDuration(rule.after || "0s")}`);
    if (rule.overdueAfter) lines.push(`  overdueAfter: ${formatDuration(rule.overdueAfter)}`);
    if (rule.match) lines.push(`  match: ${formatMatcher(rule.match)}`);
    if (rule.suppressWhen?.length) lines.push(`  suppressWhen: ${rule.suppressWhen.map(formatMatcher).join("; ")}`);
    if (rule.blockWhen?.length) lines.push(`  blockWhen: ${rule.blockWhen.map(formatMatcher).join("; ")}`);
  }
  return lines.join("\n");
}

function formatItem(item: TimelineItem): string {
  return `  - ${item.state.toUpperCase()} ${item.action} key=${item.key} rule=${item.rule} due=${item.dueAt}`;
}

function formatMatcher(matcher: NonNullable<TimelineConfig["rules"][number]["match"]>): string {
  const parts: string[] = [];
  if (matcher.type !== undefined) parts.push(`type=${Array.isArray(matcher.type) ? matcher.type.join("|") : matcher.type}`);
  if (matcher.key !== undefined) parts.push(`key=${Array.isArray(matcher.key) ? matcher.key.join("|") : matcher.key}`);
  if (matcher.where !== undefined) {
    parts.push(`where=${Object.entries(matcher.where).map(([key, value]) => `${key}:${Array.isArray(value) ? value.join("|") : String(value)}`).join(",")}`);
  }
  return parts.join(" ") || "any";
}

function formatDuration(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${key}=${String(item)}`)
      .join(",");
  }
  return "0s";
}

import type { AnyCanonResult, CanonCompareResult, CanonConfig } from "./types.js";

export function formatCanonResult(result: AnyCanonResult): string {
  if (result.kind === "company-role") {
    return [
      "iso-canon: COMPANY-ROLE",
      `key: ${result.key}`,
      `canonical: ${result.canonical}`,
      `company: ${result.company.key}`,
      `role: ${result.role.key}`,
      formatWarnings(result.warnings),
    ].filter(Boolean).join("\n");
  }
  return [
    `iso-canon: ${result.kind.toUpperCase()}`,
    `key: ${result.key}`,
    `canonical: ${result.canonical}`,
    result.tokens.length ? `tokens: ${result.tokens.join(", ")}` : "",
    formatWarnings(result.warnings),
  ].filter(Boolean).join("\n");
}

export function formatCompareResult(result: CanonCompareResult): string {
  return [
    `iso-canon: ${result.verdict.toUpperCase()} score=${formatScore(result.score)}`,
    `type: ${result.type}`,
    `left: ${result.left.key}`,
    `right: ${result.right.key}`,
    result.reasons.length ? `reasons: ${result.reasons.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

export function formatConfigSummary(config: CanonConfig): string {
  const lines = [`iso-canon config: ${config.profiles.length} profile(s)`];
  for (const profile of config.profiles) {
    lines.push(`- ${profile.name}`);
    const stripCount = profile.url?.stripQueryParams?.length ?? 0;
    const companyAliasCount = Object.keys(profile.company?.aliases ?? {}).length;
    const roleAliasCount = Object.keys(profile.role?.aliases ?? {}).length;
    lines.push(`  url strip params: ${stripCount}`);
    lines.push(`  company aliases: ${companyAliasCount}`);
    lines.push(`  role aliases: ${roleAliasCount}`);
    if (profile.match) {
      lines.push(`  match thresholds: possible=${profile.match.possible ?? "default"} strong=${profile.match.strong ?? "default"}`);
    }
  }
  return lines.join("\n");
}

function formatWarnings(warnings: string[]): string {
  return warnings.length ? `warnings: ${warnings.join("; ")}` : "";
}

function formatScore(value: number): string {
  return value.toFixed(3).replace(/0+$/g, "").replace(/\.$/g, "");
}

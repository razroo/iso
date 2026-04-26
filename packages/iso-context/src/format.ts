import type { ContextIssue, ContextPlan, RenderTarget, ResolvedContextBundle } from "./types.js";

export function formatResolvedContextBundle(bundle: ResolvedContextBundle): string {
  const lines = [`${bundle.name}`];
  if (bundle.description) lines.push(bundle.description);
  if (bundle.extends.length) lines.push(`extends: ${bundle.extends.join(", ")}`);
  if (bundle.tokenBudget !== undefined) lines.push(`tokenBudget: ${bundle.tokenBudget}`);
  if (bundle.charsPerToken !== undefined) lines.push(`charsPerToken: ${bundle.charsPerToken}`);
  lines.push("");
  lines.push("files:");
  if (!bundle.files.length) {
    lines.push("  (none)");
  } else {
    for (const file of bundle.files) {
      const label = file.label ? ` label="${file.label}"` : "";
      const required = file.required ? "required" : "optional";
      const max = file.maxTokens !== undefined ? ` maxTokens=${file.maxTokens}` : "";
      lines.push(`  - ${file.path} (${required}${label}${max})`);
    }
  }
  if (bundle.notes.length) {
    lines.push("");
    lines.push("notes:");
    for (const note of bundle.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

export function formatContextPlan(plan: ContextPlan): string {
  const budget = plan.tokenBudget === undefined ? "unbudgeted" : `${plan.totals.tokens}/${plan.tokenBudget} tokens`;
  const lines = [
    `iso-context: ${plan.ok ? "PASS" : "FAIL"} ${plan.bundle.name} (${budget}, ${plan.totals.existing}/${plan.totals.files} files)`,
    `root: ${plan.root}`,
    `charsPerToken: ${plan.charsPerToken}`,
  ];
  if (plan.files.length) {
    lines.push("");
    lines.push("files:");
    for (const file of plan.files) {
      const status = file.exists ? `${file.tokens} tokens` : file.required ? "missing" : "missing optional";
      const max = file.maxTokens !== undefined ? ` / max ${file.maxTokens}` : "";
      lines.push(`  - ${file.path}: ${status}${max}`);
    }
  }
  if (plan.issues.length) {
    lines.push("");
    lines.push("issues:");
    for (const issue of plan.issues) lines.push(`  ${formatContextIssue(issue)}`);
  }
  return lines.join("\n");
}

export function formatContextIssue(issue: ContextIssue): string {
  const path = issue.path ? ` ${issue.path}` : "";
  const budget = issue.tokens !== undefined && issue.maxTokens !== undefined
    ? ` (${issue.tokens}/${issue.maxTokens} tokens)`
    : "";
  return `${issue.severity} ${issue.kind}${path}: ${issue.message}${budget}`;
}

export function renderContextPlan(plan: ContextPlan, target: RenderTarget = "markdown"): string {
  if (target === "json") return JSON.stringify(plan, null, 2);

  const lines = [`# iso-context bundle: ${plan.bundle.name}`];
  if (plan.bundle.description) lines.push("", plan.bundle.description);
  lines.push("");
  lines.push(`- Root: \`${plan.root}\``);
  lines.push(`- Files: ${plan.totals.existing}/${plan.totals.files}`);
  lines.push(`- Estimated tokens: ${plan.totals.tokens}${plan.tokenBudget === undefined ? "" : `/${plan.tokenBudget}`}`);
  lines.push(`- Chars per token: ${plan.charsPerToken}`);
  if (plan.issues.length) {
    lines.push("");
    lines.push("## Issues");
    for (const issue of plan.issues) lines.push(`- ${formatContextIssue(issue)}`);
  }
  lines.push("");
  lines.push("## File Plan");
  for (const file of plan.files) {
    const status = file.exists ? `${file.tokens} tokens` : file.required ? "missing" : "missing optional";
    lines.push(`- \`${file.path}\` — ${status}`);
  }
  lines.push("");
  lines.push("## Context");
  for (const file of plan.files) {
    if (!file.exists) continue;
    lines.push("");
    lines.push(`### ${file.label || file.path}`);
    for (const note of file.notes) lines.push(`> ${note}`);
    lines.push(codeFence(file.content ?? "[content omitted]", infoString(file.path)));
  }
  return lines.join("\n");
}

function infoString(path: string): string {
  const clean = path.split(/[\\/]/).pop() || "";
  const extension = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() : "";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "json") return "json";
  if (extension === "yml" || extension === "yaml") return "yaml";
  if (extension === "toml") return "toml";
  if (extension === "ts") return "ts";
  if (extension === "js" || extension === "mjs") return "js";
  return "";
}

function codeFence(content: string, info: string): string {
  const longest = [...content.matchAll(/`+/g)].reduce((max, match) => Math.max(max, match[0].length), 3);
  const fence = "`".repeat(longest + 1);
  return `${fence}${info}\n${content}\n${fence}`;
}

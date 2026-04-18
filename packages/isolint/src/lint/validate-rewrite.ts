/**
 * Rewrite validation
 * ------------------
 * After the LLM rewrites a sentence, verify the rewrite is strictly better:
 *   1. Every rule that fired on the original sentence must NOT fire on the
 *      rewrite. (The fix has to actually fix.)
 *   2. No new deterministic rule may fire on the rewrite. (No regressions.)
 *   3. Markdown structure (headings, list markers, code fences, inline code
 *      ticks) must match. (Don't mangle the document.)
 *
 * Returns a list of problem strings. Empty list = rewrite accepted.
 */

import { computeLineStarts } from "./source.js";
import type { LintContext, LintFinding, ResolvedConfig, Rule } from "./types.js";

const STRUCTURE_CHECKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "headings", re: /^#{1,6}\s/gm },
  { name: "code-fences", re: /^(```+|~~~+)/gm },
  { name: "unordered-list-items", re: /^\s*[-*+]\s/gm },
  { name: "ordered-list-items", re: /^\s*\d+\.\s/gm },
  { name: "inline-code-ticks", re: /`[^`\n]+`/g },
  { name: "bold-markers", re: /\*\*[^*\n]+\*\*/g },
  { name: "link-markers", re: /\[[^\]\n]+\]\([^)\n]+\)/g },
];

export function validateRewrite(
  original: string,
  rewrite: string,
  originalFindings: LintFinding[],
  config: ResolvedConfig,
  rules: Rule[],
): string[] {
  const problems: string[] = [];

  // 1. Markdown structure preserved.
  for (const c of STRUCTURE_CHECKS) {
    const origCount = (original.match(c.re) ?? []).length;
    const newCount = (rewrite.match(c.re) ?? []).length;
    if (origCount !== newCount) {
      problems.push(`${c.name} count changed (${origCount} → ${newCount})`);
    }
  }

  // 2. Lint the rewrite. Compare findings.
  const ctx: LintContext = {
    source: rewrite,
    file: "<rewrite>",
    line_starts: computeLineStarts(rewrite),
    config,
  };

  const originalRuleIds = new Set(originalFindings.map((f) => f.rule_id));
  const rewriteFindings: LintFinding[] = [];
  for (const rule of rules) {
    if (rule.tier !== "deterministic") continue;
    if (config.rules[rule.id] === "off") continue;
    try {
      const hits = rule.check?.(ctx) ?? [];
      rewriteFindings.push(...hits);
    } catch {
      // Bad rule — ignore, we're inside validation.
    }
  }

  // 2a. Original rules must no longer fire.
  const stillFiring = rewriteFindings.filter((f) => originalRuleIds.has(f.rule_id));
  for (const f of stillFiring) {
    problems.push(`rewrite still violates ${f.rule_id}: "${f.snippet}"`);
  }

  // 2b. No new violations.
  const newFindings = rewriteFindings.filter((f) => !originalRuleIds.has(f.rule_id));
  for (const f of newFindings) {
    problems.push(`rewrite introduces new ${f.rule_id}: "${f.snippet}"`);
  }

  return problems;
}

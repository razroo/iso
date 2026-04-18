/**
 * Custom regex rules loaded from `.isolint.json` → `custom_rules`.
 *
 * Each spec becomes a deterministic rule that fires on every regex match,
 * honoring the same skip-span semantics as built-in rules.
 *
 * Safety:
 *  - Compilation errors log to stderr and skip the rule — one bad pattern
 *    never breaks the whole lint run.
 *  - Duplicate ids (including collisions with built-in rules) are dropped.
 *  - The `g` flag is always added so `RegExp.exec` iterates correctly.
 */

import { rangeFromOffsets, scanMatches, computeSkipIntervals } from "../source.js";
import type { CustomRuleSpec, LintContext, LintFinding, Rule, Severity } from "../types.js";

export function compileCustomRules(specs: CustomRuleSpec[], reservedIds: Set<string>): Rule[] {
  const seen = new Set<string>();
  const rules: Rule[] = [];

  for (const spec of specs) {
    if (!spec.id || typeof spec.id !== "string") {
      process.stderr.write(`[isolint] custom rule ignored: missing id\n`);
      continue;
    }
    if (reservedIds.has(spec.id)) {
      process.stderr.write(`[isolint] custom rule "${spec.id}" ignored: collides with a built-in rule id\n`);
      continue;
    }
    if (seen.has(spec.id)) {
      process.stderr.write(`[isolint] custom rule "${spec.id}" ignored: duplicate id\n`);
      continue;
    }
    if (!spec.pattern || typeof spec.pattern !== "string") {
      process.stderr.write(`[isolint] custom rule "${spec.id}" ignored: missing pattern\n`);
      continue;
    }
    if (!spec.message || typeof spec.message !== "string") {
      process.stderr.write(`[isolint] custom rule "${spec.id}" ignored: missing message\n`);
      continue;
    }

    const severity: Severity = spec.severity ?? "warn";
    if (severity !== "error" && severity !== "warn" && severity !== "info") {
      process.stderr.write(`[isolint] custom rule "${spec.id}" ignored: invalid severity "${severity}"\n`);
      continue;
    }

    const flags = spec.flags ?? "gi";
    const gFlags = flags.includes("g") ? flags : flags + "g";
    let re: RegExp;
    try {
      re = new RegExp(spec.pattern, gFlags);
    } catch (err) {
      process.stderr.write(
        `[isolint] custom rule "${spec.id}" ignored: invalid regex — ${(err as Error).message}\n`,
      );
      continue;
    }

    seen.add(spec.id);
    rules.push({
      id: spec.id,
      tier: "deterministic",
      severity,
      description: spec.message,
      check(ctx: LintContext): LintFinding[] {
        const skips = computeSkipIntervals(ctx.source, ctx.config.skip_spans);
        const out: LintFinding[] = [];
        for (const m of scanMatches(ctx.source, re, skips)) {
          out.push({
            rule_id: spec.id,
            severity,
            file: ctx.file,
            range: rangeFromOffsets(ctx, m.index, m.index + m[0].length),
            message: spec.message,
            snippet: ctx.source.slice(m.index, m.index + m[0].length),
          });
        }
        return out;
      },
    });
  }

  return rules;
}

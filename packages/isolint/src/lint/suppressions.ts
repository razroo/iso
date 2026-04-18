/**
 * Suppression comments
 * --------------------
 * Users can silence findings with HTML comments:
 *
 *   <!-- isolint-disable-next-line -->
 *   <!-- isolint-disable-next-line taste-word,vague-quantifier -->
 *   <!-- isolint-disable-line taste-word -->
 *
 *   <!-- isolint-disable -->
 *   ...blocked content...
 *   <!-- isolint-enable -->
 *
 * `disable` with no rule ids suppresses ALL rules on the target line(s).
 * `disable` with a comma-separated rule list suppresses only those rules.
 *
 * Legacy `isomodel-lint-*` tokens are also accepted for backwards
 * compatibility with v0.1.0.
 */

import type { LintFinding } from "./types.js";

const TOKEN = "(?:isolint|isomodel-lint)";

interface Suppression {
  /** Inclusive line number. */
  start_line: number;
  /** Inclusive line number. */
  end_line: number;
  /** null = all rules. */
  rule_ids: Set<string> | null;
}

export function parseSuppressions(source: string): Suppression[] {
  const lines = source.split("\n");
  const suppressions: Suppression[] = [];
  let blockStart: { line: number; rules: Set<string> | null } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const disableNext = line.match(
      new RegExp(`<!--\\s*${TOKEN}-disable-next-line(?:\\s+([a-z0-9,\\-\\s]+))?\\s*-->`, "i"),
    );
    if (disableNext) {
      suppressions.push({
        start_line: lineNo + 1,
        end_line: lineNo + 1,
        rule_ids: parseRuleList(disableNext[1]),
      });
      continue;
    }

    const disableSame = line.match(
      new RegExp(`<!--\\s*${TOKEN}-disable-line(?:\\s+([a-z0-9,\\-\\s]+))?\\s*-->`, "i"),
    );
    if (disableSame) {
      suppressions.push({
        start_line: lineNo,
        end_line: lineNo,
        rule_ids: parseRuleList(disableSame[1]),
      });
      continue;
    }

    const blockOpen = line.match(
      new RegExp(`<!--\\s*${TOKEN}-disable(?:\\s+([a-z0-9,\\-\\s]+))?\\s*-->`, "i"),
    );
    if (blockOpen && !disableNext && !disableSame) {
      blockStart = { line: lineNo, rules: parseRuleList(blockOpen[1]) };
      continue;
    }

    const blockClose = line.match(new RegExp(`<!--\\s*${TOKEN}-enable\\s*-->`, "i"));
    if (blockClose && blockStart) {
      suppressions.push({
        start_line: blockStart.line,
        end_line: lineNo,
        rule_ids: blockStart.rules,
      });
      blockStart = null;
    }
  }

  if (blockStart) {
    suppressions.push({
      start_line: blockStart.line,
      end_line: lines.length + 1,
      rule_ids: blockStart.rules,
    });
  }

  return suppressions;
}

function parseRuleList(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length === 0 ? null : new Set(ids);
}

export function applySuppressions(
  findings: LintFinding[],
  sourceByFile: Map<string, string>,
): LintFinding[] {
  const cache = new Map<string, Suppression[]>();
  return findings.filter((f) => {
    let sups = cache.get(f.file);
    if (!sups) {
      const source = sourceByFile.get(f.file);
      sups = source ? parseSuppressions(source) : [];
      cache.set(f.file, sups);
    }
    for (const s of sups) {
      if (f.range.line < s.start_line || f.range.line > s.end_line) continue;
      if (s.rule_ids === null || s.rule_ids.has(f.rule_id)) return false;
    }
    return true;
  });
}

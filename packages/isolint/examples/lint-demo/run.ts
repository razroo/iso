/**
 * Offline lint demo - no API key needed.
 *
 * Runs the linter against a small sample file, then rewrites every
 * `llm_fixable` finding using a mock "smart model" that returns a
 * deterministic cleaner phrasing. Proves the full --fix --llm loop.
 */
import { runLint } from "../../src/lint/runner.js";
import { DETERMINISTIC_RULES } from "../../src/lint/rules/deterministic.js";
import { computeFixes } from "../../src/lint/fix.js";
import { formatText, formatFixSummary, unifiedDiff } from "../../src/lint/report.js";
import { DEFAULT_CONFIG } from "../../src/lint/config.js";
import { MockProvider } from "../../src/providers/mock.js";

const sample = `# Example Harness Mode

When the user pastes a JD, you should classify it into one of the usual categories.

Some fields may need to be extracted, and you might want to be creative about how you name them.

If appropriate, emit a summary when relevant.

Return a JSON object with the fields from the table above.
`;

const lintReport = await runLint(
  [{ rel_path: "sample.md", source: sample }],
  DEFAULT_CONFIG,
  { rules: DETERMINISTIC_RULES },
);

process.stdout.write(formatText(lintReport) + "\n\n");

const rewrites: Record<string, string> = {
  should: "MUST",
  "one of the usual categories": "one of [billing, bug, feature_request, how_to]",
  Some: "Exactly 3",
  "might want to be creative": "MUST",
  creative: "explicit",
  "If appropriate": "If the score is >= 3.0",
  "when relevant": "for every ticket",
  "the table above": "Table 1 in the Inputs section",
};

const model = new MockProvider("rewriter", (req) => {
  const u = req.messages.find((m) => m.role === "user")?.content ?? "";
  const span = u.match(/SPAN TO REWRITE[^\n]*\n([^\n]+)/)?.[1]?.trim() ?? "";
  return rewrites[span] ?? span;
});

const fix = await computeFixes(
  [{ rel_path: "sample.md", source: sample }],
  lintReport.findings,
  { use_llm: true, model },
);

for (const f of fix.files) {
  if (!f.changed) continue;
  process.stdout.write(unifiedDiff(f.rel_path, f.original, f.fixed) + "\n");
}
process.stdout.write(formatFixSummary(fix) + "\n");

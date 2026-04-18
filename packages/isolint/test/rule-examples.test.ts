/**
 * Rule-example self-tests
 * -----------------------
 * Every rule that ships `examples: [{ bad, good, why }, ...]` gets two
 * assertions per example:
 *   - `bad` triggers the rule at least once.
 *   - `good` doesn't trigger the rule.
 *
 * The examples already feed the LLM rewrite prompt. This test makes them
 * earn their keep twice — every rule change runs them as regression checks.
 * Catches silent behavior flips (e.g., the tokenizer change in 0.4.0).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runLint } from "../src/lint/runner.js";
import { DEFAULT_CONFIG } from "../src/lint/config.js";
import { DETERMINISTIC_RULES } from "../src/lint/rules/deterministic.js";

// Default path that activates most path-gated rules (heading-without-
// imperative, step-without-verb, context-budget). Rules with narrower
// path requirements (e.g. Claude Code agents) declare their own path on
// the example object.
const DEFAULT_PATH = "modes/example.md";

async function lintSnippet(src: string, path = DEFAULT_PATH) {
  return runLint(
    [{ rel_path: path, source: src }],
    DEFAULT_CONFIG,
    { rules: DETERMINISTIC_RULES },
  );
}

describe("rule examples (self-tests)", () => {
  for (const rule of DETERMINISTIC_RULES) {
    if (!rule.examples || rule.examples.length === 0) continue;

    for (const [idx, ex] of rule.examples.entries()) {
      const path = ex.path ?? DEFAULT_PATH;
      it(`${rule.id} · example[${idx}].bad triggers the rule`, async () => {
        const r = await lintSnippet(ex.bad, path);
        const hits = r.findings.filter((f) => f.rule_id === rule.id);
        assert.ok(
          hits.length >= 1,
          `Expected rule "${rule.id}" to fire on its own bad example.\n  path: ${path}\n  bad: ${JSON.stringify(ex.bad)}\n  findings: ${JSON.stringify(r.findings.map((f) => f.rule_id))}`,
        );
      });

      it(`${rule.id} · example[${idx}].good does not trigger the rule`, async () => {
        const r = await lintSnippet(ex.good, path);
        const hits = r.findings.filter((f) => f.rule_id === rule.id);
        assert.equal(
          hits.length,
          0,
          `Expected rule "${rule.id}" NOT to fire on its own good example.\n  good: ${JSON.stringify(ex.good)}\n  findings: ${JSON.stringify(hits.map((f) => f.snippet))}`,
        );
      });
    }
  }
});

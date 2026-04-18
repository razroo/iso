/**
 * Regression simulator tests
 * --------------------------
 * The value claim of isolint is: "we rewrite harnesses so small models
 * don't break." This test asserts that numerically. For each fixture:
 *
 *   1. Simulate the ORIGINAL harness → count failure events.
 *   2. Lint + apply fixes via the deterministic mock rewriter.
 *   3. Simulate the FIXED harness → count failure events.
 *   4. Assert the fixed version has strictly fewer failures.
 *
 * If rules + simulator ever diverge (e.g. a rule fires but the simulator
 * doesn't flag the same pattern, or vice versa), we find out via a
 * lint-fixed harness that still shows failures in the trace.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runLint } from "../src/lint/runner.js";
import { computeFixes } from "../src/lint/fix.js";
import { DEFAULT_CONFIG } from "../src/lint/config.js";
import { DETERMINISTIC_RULES } from "../src/lint/rules/deterministic.js";
import { simulate, summarize } from "../src/sim/simulator.js";
import { deterministicRewriter } from "./helpers/deterministic-rewriter.js";

const DIR = resolve(import.meta.dirname ?? process.cwd() + "/test", "regression-sim");

describe("regression-sim (before vs after fix)", () => {
  const fixtures = readdirSync(DIR).filter((n) => n.endsWith(".before.md"));

  for (const file of fixtures) {
    const name = file.replace(".before.md", "");
    it(`${name}: fixed harness has strictly fewer simulator failures`, async () => {
      const source = readFileSync(resolve(DIR, file), "utf8");

      // 1. Baseline simulator trace on the original.
      const before = simulate(source);
      const beforeSummary = summarize(before);

      // 2. Lint + fix using the deterministic mock rewriter.
      const lintReport = await runLint(
        [{ rel_path: `modes/${name}.md`, source }],
        DEFAULT_CONFIG,
        { rules: DETERMINISTIC_RULES },
      );
      const fixReport = await computeFixes(
        [{ rel_path: `modes/${name}.md`, source }],
        lintReport.findings,
        {
          use_llm: true,
          model: deterministicRewriter(),
          config: DEFAULT_CONFIG,
          samples_per_attempt: 1,
          max_attempts: 1,
        },
      );
      const fixed = fixReport.files[0]?.fixed ?? source;

      // 3. Simulator on the fixed harness.
      const after = simulate(fixed);
      const afterSummary = summarize(after);

      // 4. Strict-improvement assertions.
      assert.ok(
        after.failed < before.failed,
        `Expected fewer simulator failures after fix.\n  before: failed=${before.failed} ${JSON.stringify(beforeSummary)}\n  after:  failed=${after.failed} ${JSON.stringify(afterSummary)}\n  fixed source:\n${fixed}`,
      );
      assert.ok(
        after.fragility <= before.fragility,
        `Fragility should not increase. before=${before.fragility.toFixed(2)} after=${after.fragility.toFixed(2)}`,
      );
    });
  }
});

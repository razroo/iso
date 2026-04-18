/**
 * Fix-pipeline golden tests
 * -------------------------
 * Parallel to test/golden/ (which covers lint output). These verify the
 * FIX path end-to-end: run lint + fix with a deterministic mock rewriter,
 * compare the produced file to an expected `.after.md`. Catches regressions
 * in coalescing, validation, retry, and edit ordering without depending on
 * real LLM output.
 *
 * Refresh after intentional fix-engine changes:
 *   UPDATE_GOLDEN=1 npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { runLint } from "../src/lint/runner.js";
import { computeFixes } from "../src/lint/fix.js";
import { DEFAULT_CONFIG } from "../src/lint/config.js";
import { DETERMINISTIC_RULES } from "../src/lint/rules/deterministic.js";
import { deterministicRewriter } from "./helpers/deterministic-rewriter.js";

const DIR = resolve(import.meta.dirname ?? process.cwd() + "/test", "fix-golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

async function fixFixture(beforePath: string): Promise<string> {
  const source = readFileSync(beforePath, "utf8");
  const rel = "modes/" + beforePath.split("/").pop()!.replace(".before.md", ".md");
  const lintResult = await runLint(
    [{ rel_path: rel, source }],
    DEFAULT_CONFIG,
    { rules: DETERMINISTIC_RULES },
  );
  const fixResult = await computeFixes(
    [{ rel_path: rel, source }],
    lintResult.findings,
    {
      use_llm: true,
      model: deterministicRewriter(),
      config: DEFAULT_CONFIG,
      samples_per_attempt: 1, // deterministic mock; one sample suffices
      max_attempts: 1,
    },
  );
  return fixResult.files[0]?.fixed ?? source;
}

describe("fix pipeline golden", () => {
  const fixtures = readdirSync(DIR)
    .filter((n) => n.endsWith(".before.md"))
    .map((n) => resolve(DIR, n));

  for (const before of fixtures) {
    const name = before.split("/").pop()!.replace(".before.md", "");
    it(name, async () => {
      const fixed = await fixFixture(before);
      const afterPath = before.replace(".before.md", ".after.md");

      if (UPDATE || !existsSync(afterPath)) {
        writeFileSync(afterPath, fixed, "utf8");
        return;
      }

      const expected = readFileSync(afterPath, "utf8");
      assert.equal(
        fixed,
        expected,
        `Fix output diverged for ${name}. Rerun with UPDATE_GOLDEN=1 to refresh if the change is intentional.`,
      );
    });
  }
});

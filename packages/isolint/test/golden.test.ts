/**
 * Golden-file regression tests
 * ----------------------------
 * Each `test/golden/<name>.md` has a paired `<name>.findings.json` listing
 * the expected lint findings (rule_id, severity, line, snippet) in
 * deterministic order. CI fails if lint output diverges from the golden.
 *
 * To refresh after an intentional rule change:
 *   UPDATE_GOLDEN=1 npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runLint } from "../src/lint/runner.js";
import { DEFAULT_CONFIG } from "../src/lint/config.js";
import { DETERMINISTIC_RULES } from "../src/lint/rules/deterministic.js";

const GOLDEN_DIR = resolve(import.meta.dirname ?? process.cwd() + "/test", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface GoldenFinding {
  rule_id: string;
  severity: string;
  line: number;
  snippet: string;
}

function expectedPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, ".findings.json");
}

async function lintFixture(mdPath: string): Promise<GoldenFinding[]> {
  const source = readFileSync(mdPath, "utf8");
  const rel = mdPath.slice(GOLDEN_DIR.length - "golden".length);
  // Point the lint at modes/ so path-gated rules (heading-without-imperative,
  // step-without-verb) activate; no real repo_files needed.
  const relPath = `golden/modes/${rel.split("/").pop()}`;
  const r = await runLint([{ rel_path: relPath, source }], DEFAULT_CONFIG, {
    rules: DETERMINISTIC_RULES,
  });
  return r.findings
    .map((f) => ({
      rule_id: f.rule_id,
      severity: f.severity,
      line: f.range.line,
      snippet: f.snippet,
    }))
    .sort((a, b) => a.line - b.line || a.rule_id.localeCompare(b.rule_id) || a.snippet.localeCompare(b.snippet));
}

describe("golden fixtures", () => {
  const mdFiles = readdirSync(GOLDEN_DIR)
    .filter((n) => n.endsWith(".md"))
    .map((n) => resolve(GOLDEN_DIR, n));

  for (const md of mdFiles) {
    const name = md.slice(GOLDEN_DIR.length + 1).replace(/\.md$/, "");
    it(name, async () => {
      const actual = await lintFixture(md);
      const goldenPath = expectedPath(md);

      if (UPDATE) {
        writeFileSync(goldenPath, JSON.stringify({ findings: actual }, null, 2) + "\n", "utf8");
        return;
      }

      const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as { findings: GoldenFinding[] };
      const expected = [...golden.findings].sort(
        (a, b) => a.line - b.line || a.rule_id.localeCompare(b.rule_id) || a.snippet.localeCompare(b.snippet),
      );

      assert.deepEqual(
        actual,
        expected,
        `Golden diverged for ${name}. Rerun with UPDATE_GOLDEN=1 to refresh if the change is intentional.`,
      );
    });
  }
});

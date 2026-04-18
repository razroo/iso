import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatHistory, loadHistory } from "../src/history.js";
import type { RunResult } from "../src/runner.js";

function makeReport(timestamp: string, rules: Array<[string, boolean]>): RunResult {
  return {
    agent: "a",
    cases: [
      {
        name: "c",
        trials: [
          {
            output: "",
            checks: rules.map(([rule, passed]) => ({
              rule,
              check: "word_count_le",
              passed,
              detail: "",
            })),
          },
        ],
      },
    ],
    definedRules: rules.map(([r]) => r),
    meta: {
      via: "fake",
      model: "m",
      judgeModel: "m",
      temperature: 0,
      timestamp,
    },
  };
}

function writeReports(reports: RunResult[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "agentmd-history-"));
  return reports.map((r, i) => {
    const p = join(dir, `report-${i}.json`);
    writeFileSync(p, JSON.stringify(r));
    return p;
  });
}

test("loadHistory: sorts reports by timestamp", () => {
  const paths = writeReports([
    makeReport("2026-04-03T00:00:00.000Z", [["H1", true]]),
    makeReport("2026-04-01T00:00:00.000Z", [["H1", false]]),
    makeReport("2026-04-02T00:00:00.000Z", [["H1", true]]),
  ]);
  const entries = loadHistory(paths);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].result.meta.timestamp, "2026-04-01T00:00:00.000Z");
  assert.equal(entries[2].result.meta.timestamp, "2026-04-03T00:00:00.000Z");
});

test("formatHistory: shows per-rule trend with delta", () => {
  const paths = writeReports([
    makeReport("2026-04-01T00:00:00.000Z", [["H1", false], ["D1", true]]),
    makeReport("2026-04-02T00:00:00.000Z", [["H1", true], ["D1", true]]),
  ]);
  const rendered = formatHistory(loadHistory(paths));
  assert.match(rendered, /\[H1\].*0%.*100%/s);
  assert.match(rendered, /\(\+100%\)/);
  assert.match(rendered, /overall:/);
});

test("formatHistory: --rule filter narrows to one rule", () => {
  const paths = writeReports([
    makeReport("2026-04-01T00:00:00.000Z", [["H1", true], ["D1", false]]),
  ]);
  const rendered = formatHistory(loadHistory(paths), { ruleFilter: "D1" });
  assert.match(rendered, /\[D1\]/);
  assert.ok(!/\[H1\]/.test(rendered));
});

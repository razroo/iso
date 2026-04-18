import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBaselineDiff, toJSON } from "../src/report.js";
import type { RunResult } from "../src/runner.js";

function makeResult(overrides: Partial<RunResult>): RunResult {
  return {
    agent: "a",
    cases: [],
    definedRules: [],
    meta: {
      via: "fake",
      model: null,
      judgeModel: null,
      temperature: null,
      timestamp: "2026-04-18T10:00:00.000Z",
    },
    ...overrides,
  };
}

function singleTrialCase(name: string, checks: Array<{ rule: string; check: string; passed: boolean; detail?: string }>) {
  return {
    name,
    trials: [
      {
        output: "",
        checks: checks.map((c) => ({ rule: c.rule, check: c.check, passed: c.passed, detail: c.detail ?? "" })),
      },
    ],
  };
}

test("toJSON emits a parseable RunResult", () => {
  const r = makeResult({
    definedRules: ["H1"],
    cases: [singleTrialCase("c", [{ rule: "H1", check: "word_count_le", passed: true, detail: "1 word (limit 5)" }])],
  });
  const parsed = JSON.parse(toJSON(r));
  assert.equal(parsed.agent, "a");
  assert.equal(parsed.cases[0].trials[0].checks[0].rule, "H1");
  assert.equal(parsed.meta.via, "fake");
});

test("formatBaselineDiff: flags regressions", () => {
  const baseline = makeResult({
    cases: [
      singleTrialCase("c1", [
        { rule: "H1", check: "word_count_le", passed: true },
        { rule: "D1", check: "llm_judge", passed: true },
      ]),
    ],
  });
  const current = makeResult({
    cases: [
      singleTrialCase("c1", [
        { rule: "H1", check: "word_count_le", passed: true },
        { rule: "D1", check: "llm_judge", passed: false },
      ]),
    ],
  });
  const diff = formatBaselineDiff(current, baseline);
  assert.deepEqual(diff.regressedRules, ["D1"]);
  assert.match(diff.rendered, /regression/);
});

test("formatBaselineDiff: no regression when identical", () => {
  const r = makeResult({
    cases: [singleTrialCase("c1", [{ rule: "H1", check: "word_count_le", passed: true }])],
  });
  const diff = formatBaselineDiff(r, r);
  assert.deepEqual(diff.regressedRules, []);
});

test("formatBaselineDiff: marks new and removed rules distinctly", () => {
  const baseline = makeResult({
    cases: [singleTrialCase("c", [{ rule: "H1", check: "word_count_le", passed: true }])],
  });
  const current = makeResult({
    cases: [singleTrialCase("c", [{ rule: "H2", check: "word_count_le", passed: true }])],
  });
  const diff = formatBaselineDiff(current, baseline);
  assert.match(diff.rendered, /\(new rule\)/);
  assert.match(diff.rendered, /\(removed from fixtures\)/);
});

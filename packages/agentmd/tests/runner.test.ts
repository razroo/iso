import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { run } from "../src/runner.js";
import { formatReport } from "../src/report.js";
import type { Fixtures } from "../src/fixtures.js";

const DOC = `# Agent: echo-agent

Echoes a fixed output for testing.

## Hard limits

- [H1] at most 5 words
  why: testing

## Procedure

1. emit five words
`;

const FIXTURES: Fixtures = {
  cases: [
    {
      name: "basic",
      input: "whatever",
      expectations: [
        { rule: "H1", check: "word_count_le", value: 5 },
        { rule: "H1", check: "does_not_contain", value: ["banned"] },
      ],
    },
    {
      name: "failing",
      input: "whatever",
      expectations: [
        { rule: "H1", check: "word_count_le", value: 2 },
      ],
    },
  ],
};

test("run: executes all cases and checks with fake agent", async () => {
  const doc = parse(DOC);
  const agent = async () => "one two three four five";
  const result = await run(doc, FIXTURES, { agent });

  assert.equal(result.agent, "echo-agent");
  assert.equal(result.cases.length, 2);

  const basic = result.cases[0];
  assert.equal(basic.trials.length, 1);
  assert.equal(basic.trials[0].checks.length, 2);
  assert.equal(basic.trials[0].checks[0].passed, true);
  assert.equal(basic.trials[0].checks[1].passed, true);

  const failing = result.cases[1];
  assert.equal(failing.trials[0].checks[0].passed, false);
});

test("run: passes rendered system prompt to the agent", async () => {
  const doc = parse(DOC);
  let capturedSystem = "";
  const agent = async (system: string) => {
    capturedSystem = system;
    return "ok";
  };
  await run(doc, { cases: [{ name: "n", input: "x", expectations: [] }] }, { agent });
  assert.match(capturedSystem, /Agent: echo-agent/);
  assert.match(capturedSystem, /Hard limits/);
  assert.match(capturedSystem, /\[H1\]/);
});

test("run: rejects fixtures that reference an undefined rule id", async () => {
  const doc = parse(DOC);
  const agent = async () => "out";
  const fixtures: Fixtures = {
    cases: [
      {
        name: "phantom",
        input: "x",
        expectations: [{ rule: "H9", check: "word_count_le", value: 5 }],
      },
    ],
  };
  await assert.rejects(() => run(doc, fixtures, { agent }), /\[H9\]/);
});

test("run: rejects fixtures whose agent field doesn't match the doc", async () => {
  const doc = parse(DOC);
  const agent = async () => "out";
  const fixtures: Fixtures = {
    agent: "some-other-agent",
    cases: [],
  };
  await assert.rejects(() => run(doc, fixtures, { agent }), /some-other-agent/);
});

test("run: fixture agent matching the doc passes validation", async () => {
  const doc = parse(DOC);
  const agent = async () => "out";
  const fixtures: Fixtures = { agent: "echo-agent", cases: [] };
  const r = await run(doc, fixtures, { agent });
  assert.equal(r.agent, "echo-agent");
});

test("run: executes cases in parallel up to --concurrency", async () => {
  const doc = parse(DOC);
  let active = 0;
  let maxActive = 0;
  const agent = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return "ok";
  };
  const fixtures: Fixtures = {
    cases: Array.from({ length: 6 }, (_, i) => ({
      name: `c${i}`,
      input: "x",
      expectations: [],
    })),
  };
  const r = await run(doc, fixtures, { agent, concurrency: 3 });
  assert.equal(r.cases.length, 6);
  assert.ok(maxActive >= 2, `expected parallelism; maxActive was ${maxActive}`);
  assert.ok(maxActive <= 3, `expected concurrency cap of 3; saw ${maxActive}`);
});

test("run: --trials N runs each case N times and aggregates per rule", async () => {
  const doc = parse(DOC);
  let call = 0;
  const agent = async () => {
    call += 1;
    return call % 2 === 0 ? "one two three four five six" : "one two three four five";
  };
  const fixtures: Fixtures = {
    cases: [
      {
        name: "case",
        input: "x",
        expectations: [{ rule: "H1", check: "word_count_le", value: 5 }],
      },
    ],
  };
  const result = await run(doc, fixtures, { agent, trials: 4 });
  assert.equal(result.cases[0].trials.length, 4);
  const passes = result.cases[0].trials.filter((t) => t.checks[0].passed).length;
  assert.equal(passes, 2);
});

test("run: --rule filter drops non-matching expectations and empty cases", async () => {
  const doc = parse(DOC);
  const agent = async () => "ok";
  const fixtures: Fixtures = {
    cases: [
      {
        name: "c-H1",
        input: "x",
        expectations: [{ rule: "H1", check: "word_count_le", value: 100 }],
      },
      {
        name: "c-mixed",
        input: "x",
        expectations: [
          { rule: "H1", check: "word_count_le", value: 100 },
          { rule: "D1", check: "word_count_le", value: 100 },
        ],
      },
    ],
  };
  const docWithD1 = parse(`# Agent: echo-agent
\n## Hard limits
\n- [H1] thing
  why: measured motivation that is long enough
\n## Defaults
\n- [D1] other
  why: another motivation that is long enough

## Procedure

1. use [H1] and [D1]
`);
  const result = await run(docWithD1, fixtures, { agent, ruleFilter: "H1" });
  assert.equal(result.cases.length, 2);
  for (const c of result.cases) {
    for (const t of c.trials) {
      for (const ck of t.checks) {
        assert.equal(ck.rule, "H1");
      }
    }
  }
});

test("run: onCaseComplete fires once per case with index/total", async () => {
  const doc = parse(DOC);
  const agent = async () => "ok";
  const events: { caseIndex: number; totalCases: number; caseName: string }[] = [];
  const fixtures: Fixtures = {
    cases: Array.from({ length: 3 }, (_, i) => ({
      name: `c${i}`,
      input: "x",
      expectations: [],
    })),
  };
  await run(doc, fixtures, {
    agent,
    onCaseComplete: ({ caseIndex, totalCases, caseName }) => {
      events.push({ caseIndex, totalCases, caseName });
    },
  });
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.totalCases), [3, 3, 3]);
  assert.deepEqual([...new Set(events.map((e) => e.caseIndex))].sort(), [1, 2, 3]);
});

test("run: embeds meta (via, model, temperature, timestamp)", async () => {
  const doc = parse(DOC);
  const agent = async () => "ok";
  const r = await run(doc, { cases: [] }, {
    agent,
    meta: { via: "api", model: "m", judgeModel: "j", temperature: 0 },
  });
  assert.equal(r.meta.via, "api");
  assert.equal(r.meta.model, "m");
  assert.equal(r.meta.temperature, 0);
  assert.ok(r.meta.timestamp.match(/^\d{4}-\d{2}-\d{2}T/));
});

test("report: flags rules with no fixture expectations", async () => {
  const src = `# Agent: r
\n## Hard limits\n\n- [H1] one\n  why: x\n- [H2] two\n  why: y\n\n## Procedure\n\n1. step\n`;
  const doc = parse(src);
  const agent = async () => "out";
  const fixtures: Fixtures = {
    cases: [
      {
        name: "c",
        input: "i",
        expectations: [{ rule: "H1", check: "word_count_le", value: 100 }],
      },
    ],
  };
  const result = await run(doc, fixtures, { agent });
  const report = formatReport(result);
  assert.match(report, /untested rules/);
  assert.match(report, /\[H2\]/);
});

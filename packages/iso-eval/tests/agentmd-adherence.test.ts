import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnSyncReturns } from "node:child_process";
import { runAgentmdAdherence } from "../src/checks/agentmd-adherence.js";
import type { AgentmdAdherenceCheck } from "../src/types.js";

function mkSuiteDir(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "iso-eval-agentmd-"));
  writeFileSync(join(dir, "agent.md"), "# Agent: test\n");
  writeFileSync(join(dir, "fixtures.yml"), "agent: test\ncases: []\n");
  return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function fakeSpawn(
  status: number,
  stdout: string,
  stderr = "",
): SpawnSyncReturns<string> {
  return {
    pid: 1,
    status,
    signal: null,
    stdout,
    stderr,
    output: [null, stdout, stderr],
  } as SpawnSyncReturns<string>;
}

function mkCheck(overrides: Partial<AgentmdAdherenceCheck> = {}): AgentmdAdherenceCheck {
  return {
    type: "agentmd_adherence",
    promptFile: "agent.md",
    fixtures: "fixtures.yml",
    minPassRate: 0.8,
    ...overrides,
  };
}

const FULL_PASS_REPORT = JSON.stringify({
  agent: "test",
  cases: [
    {
      name: "case1",
      trials: [
        {
          checks: [
            { rule: "H1", check: "contains_all", passed: true },
            { rule: "H1", check: "word_count_le", passed: true },
            { rule: "H3", check: "llm_judge", passed: true },
          ],
        },
      ],
    },
  ],
});

const PARTIAL_H3 = JSON.stringify({
  agent: "test",
  cases: [
    {
      name: "case1",
      trials: [
        {
          checks: [
            { rule: "H1", check: "contains_all", passed: true },
            { rule: "H3", check: "llm_judge", passed: false },
            { rule: "H3", check: "llm_judge", passed: true },
          ],
        },
      ],
    },
  ],
});

test("agentmd_adherence: passes when all rules meet the min pass rate", async () => {
  const suite = mkSuiteDir();
  try {
    const result = await runAgentmdAdherence(mkCheck({ minPassRate: 1.0 }), {
      suiteDir: suite.path,
      spawn: () => fakeSpawn(0, FULL_PASS_REPORT),
    });
    assert.equal(result.passed, true);
    assert.match(result.detail, /3\/3 pass/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: ruleId filters to a single rule's pass rate", async () => {
  const suite = mkSuiteDir();
  try {
    // Overall pass rate: 3/4 = 75%. Rule H3 alone: 1/2 = 50%.
    const result = await runAgentmdAdherence(
      mkCheck({ ruleId: "H3", minPassRate: 0.9 }),
      { suiteDir: suite.path, spawn: () => fakeSpawn(0, PARTIAL_H3) },
    );
    assert.equal(result.passed, false);
    assert.match(result.detail, /rule H3: 1\/2 pass/);
    assert.match(result.detail, /50\.0% < 90\.0%/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: missing promptFile fails fast with a clear detail", async () => {
  const suite = mkSuiteDir();
  try {
    const result = await runAgentmdAdherence(
      mkCheck({ promptFile: "does-not-exist.md" }),
      { suiteDir: suite.path, spawn: () => fakeSpawn(0, FULL_PASS_REPORT) },
    );
    assert.equal(result.passed, false);
    assert.match(result.detail, /promptFile not found/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: non-zero exit from agentmd surfaces the stderr snippet", async () => {
  const suite = mkSuiteDir();
  try {
    const result = await runAgentmdAdherence(mkCheck(), {
      suiteDir: suite.path,
      spawn: () => fakeSpawn(2, "", "agentmd: invalid model id"),
    });
    assert.equal(result.passed, false);
    assert.match(result.detail, /agentmd exited 2/);
    assert.match(result.detail, /invalid model id/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: invalid JSON output from agentmd fails with a parse message", async () => {
  const suite = mkSuiteDir();
  try {
    const result = await runAgentmdAdherence(mkCheck(), {
      suiteDir: suite.path,
      spawn: () => fakeSpawn(0, "not json at all"),
    });
    assert.equal(result.passed, false);
    assert.match(result.detail, /not valid JSON/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: empty cases fail with a useful detail", async () => {
  const suite = mkSuiteDir();
  try {
    const result = await runAgentmdAdherence(mkCheck(), {
      suiteDir: suite.path,
      spawn: () => fakeSpawn(0, JSON.stringify({ agent: "test", cases: [] })),
    });
    assert.equal(result.passed, false);
    assert.match(result.detail, /0 per-rule checks/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: ruleId that matches no checks fails with a named-rule detail", async () => {
  const suite = mkSuiteDir();
  try {
    const result = await runAgentmdAdherence(
      mkCheck({ ruleId: "H99" }),
      { suiteDir: suite.path, spawn: () => fakeSpawn(0, FULL_PASS_REPORT) },
    );
    assert.equal(result.passed, false);
    assert.match(result.detail, /no checks found for rule "H99"/);
  } finally {
    suite.cleanup();
  }
});

test("agentmd_adherence: forwards via, model, timeout flags to agentmd", async () => {
  const suite = mkSuiteDir();
  try {
    const seen: { args: string[]; opts: unknown }[] = [];
    await runAgentmdAdherence(
      mkCheck({ via: "api", model: "claude-sonnet-4-6", timeoutMs: 30_000 }),
      {
        suiteDir: suite.path,
        spawn: (args, opts) => {
          seen.push({ args, opts });
          return fakeSpawn(0, FULL_PASS_REPORT);
        },
      },
    );
    assert.equal(seen.length, 1);
    assert.ok(seen[0].args.includes("--via"));
    assert.ok(seen[0].args.includes("api"));
    assert.ok(seen[0].args.includes("--model"));
    assert.ok(seen[0].args.includes("claude-sonnet-4-6"));
    assert.deepEqual((seen[0].opts as { timeoutMs?: number }).timeoutMs, 30_000);
  } finally {
    suite.cleanup();
  }
});

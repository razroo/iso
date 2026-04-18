import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSuite } from "../src/parser.js";
import { run } from "../src/runner.js";
import { fakeRunner } from "../src/runners/fake.js";
import type { RunnerFn, RunnerContext, RunnerResult } from "../src/types.js";

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "iso-eval-test-"));
}

test("fake runner: happy path — file_exists + file_contains both pass", async () => {
  const base = scratchDir();
  try {
    mkdirSync(join(base, "workspace"));
    mkdirSync(join(base, "tasks"));
    writeFileSync(
      join(base, "tasks", "write-greeting.md"),
      ['Write "hello from fake" to greeting.txt.', "", '$ echo "hello from fake" > greeting.txt'].join("\n"),
    );
    writeFileSync(
      join(base, "eval.yml"),
      [
        "suite: test-basic",
        "runner: fake",
        "tasks:",
        "  - id: write-greeting",
        "    prompt: tasks/write-greeting.md",
        "    workspace: workspace/",
        "    trials: 1",
        "    checks:",
        "      - type: file_exists",
        "        path: greeting.txt",
        "      - type: file_contains",
        "        path: greeting.txt",
        '        value: "hello from fake"',
      ].join("\n"),
    );

    const suite = loadSuite(join(base, "eval.yml"));
    assert.equal(suite.name, "test-basic");
    assert.equal(suite.runner, "fake");
    assert.equal(suite.tasks.length, 1);
    assert.equal(suite.tasks[0].checks.length, 2);
    assert.ok(suite.tasks[0].prompt.includes("greeting.txt"));

    const report = await run(suite, { runner: fakeRunner });
    assert.equal(report.passed, true, "report should pass");
    assert.equal(report.tasks[0].passed, true);
    assert.equal(report.tasks[0].trials.length, 1);
    assert.equal(report.tasks[0].trials[0].checks.length, 2);
    assert.ok(report.tasks[0].trials[0].checks.every((c) => c.passed));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("missing expected file: report fails, check failure is reported", async () => {
  const base = scratchDir();
  try {
    mkdirSync(join(base, "workspace"));
    writeFileSync(
      join(base, "eval.yml"),
      [
        "suite: test-fail",
        "runner: fake",
        "tasks:",
        "  - id: noop",
        '    prompt: "do nothing"',
        "    workspace: workspace/",
        "    checks:",
        "      - type: file_exists",
        "        path: nope.txt",
      ].join("\n"),
    );
    const suite = loadSuite(join(base, "eval.yml"));
    const report = await run(suite, { runner: fakeRunner });
    assert.equal(report.passed, false);
    assert.equal(report.tasks[0].passed, false);
    assert.equal(report.tasks[0].trials[0].checks[0].passed, false);
    assert.match(report.tasks[0].trials[0].checks[0].detail, /missing: nope\.txt/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("custom RunnerFn: library API accepts any runner, not just shipped ones", async () => {
  const base = scratchDir();
  try {
    mkdirSync(join(base, "workspace"));
    writeFileSync(
      join(base, "eval.yml"),
      [
        "suite: test-custom",
        "runner: fake",
        "tasks:",
        "  - id: via-custom",
        '    prompt: "(ignored)"',
        "    workspace: workspace/",
        "    checks:",
        "      - type: file_exists",
        "        path: injected.txt",
      ].join("\n"),
    );
    const { writeFileSync: wf } = await import("node:fs");
    const custom: RunnerFn = async (ctx: RunnerContext): Promise<RunnerResult> => {
      wf(join(ctx.workspaceDir, "injected.txt"), "ok\n");
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 0 };
    };
    const suite = loadSuite(join(base, "eval.yml"));
    const report = await run(suite, { runner: custom });
    assert.equal(report.passed, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("trial workspaces are isolated — one task doesn't leak into the next", async () => {
  const base = scratchDir();
  try {
    mkdirSync(join(base, "workspace"));
    writeFileSync(
      join(base, "eval.yml"),
      [
        "suite: test-isolation",
        "runner: fake",
        "tasks:",
        "  - id: write-a",
        '    prompt: "$ echo A > file.txt"',
        "    workspace: workspace/",
        "    checks:",
        "      - type: file_contains",
        "        path: file.txt",
        "        value: A",
        "  - id: write-b",
        '    prompt: "$ echo B > file.txt"',
        "    workspace: workspace/",
        "    checks:",
        "      - type: file_contains",
        "        path: file.txt",
        "        value: B",
        "      - type: file_not_contains",
        "        path: file.txt",
        "        value: A",
      ].join("\n"),
    );
    const suite = loadSuite(join(base, "eval.yml"));
    const report = await run(suite, { runner: fakeRunner });
    assert.equal(report.passed, true, "both tasks should pass in isolated workspaces");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

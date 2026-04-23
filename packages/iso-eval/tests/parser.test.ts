import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSuite } from "../src/parser.js";

function writeSuite(body: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "iso-eval-parser-"));
  const p = join(dir, "eval.yml");
  writeFileSync(p, body);
  return { path: p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("rejects file without suite name", () => {
  const s = writeSuite("runner: fake\ntasks: []\n");
  try {
    assert.throws(() => loadSuite(s.path), /"suite"/);
  } finally {
    s.cleanup();
  }
});

test("rejects unknown runner", () => {
  const s = writeSuite(
    ["suite: x", "runner: rogue", "tasks:", "  - id: t1", '    prompt: "hi"', "    workspace: .", "    checks: []"].join("\n"),
  );
  try {
    assert.throws(() => loadSuite(s.path), /runner/);
  } finally {
    s.cleanup();
  }
});

test("accepts built-in real runners and resolves harness.source", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: claude-code",
      "harness:",
      "  source: ./dist-harness",
      "tasks:",
      "  - id: t1",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks: []",
    ].join("\n"),
  );
  try {
    const suite = loadSuite(s.path);
    assert.equal(suite.runner, "claude-code");
    assert.equal(suite.harnessSource, join(dirname(s.path), "dist-harness"));
  } finally {
    s.cleanup();
  }
});

test("accepts opencode as a built-in runner", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: opencode",
      "tasks:",
      "  - id: t1",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks: []",
    ].join("\n"),
  );
  try {
    const suite = loadSuite(s.path);
    assert.equal(suite.runner, "opencode");
  } finally {
    s.cleanup();
  }
});

test("accepts cursor as a built-in runner", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: cursor",
      "tasks:",
      "  - id: t1",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks: []",
    ].join("\n"),
  );
  try {
    const suite = loadSuite(s.path);
    assert.equal(suite.runner, "cursor");
  } finally {
    s.cleanup();
  }
});

test("rejects duplicate task ids", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: fake",
      "tasks:",
      "  - id: dup",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks: []",
      "  - id: dup",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks: []",
    ].join("\n"),
  );
  try {
    assert.throws(() => loadSuite(s.path), /duplicate task id/);
  } finally {
    s.cleanup();
  }
});

test("rejects unknown check type", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: fake",
      "tasks:",
      "  - id: t1",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks:",
      "      - type: bogus_check",
    ].join("\n"),
  );
  try {
    assert.throws(() => loadSuite(s.path), /unknown or missing type "bogus_check"/);
  } finally {
    s.cleanup();
  }
});

test("inline prompt (with newline) is preserved verbatim — no file read attempted", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: fake",
      "tasks:",
      "  - id: t1",
      "    prompt: |",
      "      line one",
      "      line two",
      "    workspace: .",
      "    checks: []",
    ].join("\n"),
  );
  try {
    const suite = loadSuite(s.path);
    assert.equal(suite.tasks[0].prompt, "line one\nline two\n");
    assert.equal(suite.tasks[0].promptPath, undefined);
  } finally {
    s.cleanup();
  }
});

test("defaults: trials = 1 when not specified, timeoutMs undefined", () => {
  const s = writeSuite(
    [
      "suite: x",
      "runner: fake",
      "tasks:",
      "  - id: t1",
      '    prompt: "hi"',
      "    workspace: .",
      "    checks: []",
    ].join("\n"),
  );
  try {
    const suite = loadSuite(s.path);
    assert.equal(suite.tasks[0].trials, 1);
    assert.equal(suite.timeoutMs, undefined);
  } finally {
    s.cleanup();
  }
});

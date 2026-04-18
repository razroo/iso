import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

function mktmp(): string {
  return mkdtempSync(join(tmpdir(), "agentmd-cli-test-"));
}

function writeAgent(path: string, opts: { dupHeading?: boolean; missingProcedure?: boolean } = {}) {
  const header = opts.dupHeading ? "# Agent: x\n# Agent: y\n" : "# Agent: x\n";
  const body =
    `\n## Hard limits\n\n- [H1] keep it short and readable\n  why: long outputs degrade the UI and confuse reviewers\n\n` +
    (opts.missingProcedure ? "" : "## Procedure\n\n1. Self-check against [H1]\n");
  writeFileSync(path, header + body);
}

function runCli(args: string[], stdin?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    input: stdin,
    encoding: "utf8",
  });
}

test("lint: accepts multiple files and aggregates results", () => {
  const dir = mktmp();
  const a = join(dir, "a.md");
  const b = join(dir, "b.md");
  writeAgent(a);
  writeAgent(b);
  const r = runCli(["lint", a, b]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /a\.md: ok/);
  assert.match(r.stdout, /b\.md: ok/);
});

test("lint: expands a glob to concrete files", () => {
  const dir = mktmp();
  const a = join(dir, "a.md");
  const b = join(dir, "b.md");
  writeAgent(a);
  writeAgent(b);
  const r = runCli(["lint", join(dir, "*.md")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /a\.md: ok/);
  assert.match(r.stdout, /b\.md: ok/);
});

test("lint: exit code 1 if any file has errors", () => {
  const dir = mktmp();
  const good = join(dir, "good.md");
  const bad = join(dir, "bad.md");
  writeAgent(good);
  writeAgent(bad, { missingProcedure: true });
  const r = runCli(["lint", good, bad]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /L9b/);
});

test("lint: --format=json produces parseable JSON", () => {
  const dir = mktmp();
  const a = join(dir, "a.md");
  writeAgent(a, { dupHeading: true });
  const r = runCli(["lint", a, "--format=json"]);
  // L12 is a warning, not an error, so exit is 0
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.length, 1);
  assert.ok(parsed[0].diagnostics.some((d: { code: string }) => d.code === "L12"));
});

test("lint: --format github emits workflow annotations", () => {
  const dir = mktmp();
  const a = join(dir, "a.md");
  writeAgent(a, { missingProcedure: true });
  const r = runCli(["lint", a, "--format", "github"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error file=.*,title=L9b::/m);
});

const CLEAN_AGENT =
  "# Agent: x\n\n## Hard limits\n\n- [H1] keep replies under forty words\n  why: long outputs degrade the UI and confuse reviewers downstream\n\n## Procedure\n\n1. Do [H1]\n";

test("lint: reads stdin when the path is '-'", () => {
  const r = runCli(["lint", "-"], CLEAN_AGENT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /<stdin>: ok/);
});

test("render: reads stdin when the path is '-'", () => {
  const r = runCli(["render", "-"], CLEAN_AGENT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^# Agent: x/);
  assert.match(r.stdout, /must never be violated/);
});

test("CLI: --flag=value form is accepted alongside --flag value", () => {
  const dir = mktmp();
  const a = join(dir, "a.md");
  writeAgent(a);
  const r1 = runCli(["lint", a, "--format=json"]);
  const r2 = runCli(["lint", a, "--format", "json"]);
  assert.equal(r1.status, 0);
  assert.equal(r2.status, 0);
  assert.equal(r1.stdout.trim(), r2.stdout.trim());
});

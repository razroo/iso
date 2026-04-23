import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenCodeRunner } from "../src/runners/opencode.js";
import type { RunnerContext } from "../src/types.js";

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "iso-eval-opencode-"));
}

test("opencode runner stages AGENTS.md, opencode.json, and .opencode into the workspace", async () => {
  const workspace = scratchDir();
  const harness = scratchDir();
  mkdirSync(join(harness, ".opencode", "agents"), { recursive: true });
  writeFileSync(join(harness, "AGENTS.md"), "agent instructions\n");
  writeFileSync(join(harness, "opencode.json"), '{ "model": "opencode/big-pickle" }\n');
  writeFileSync(join(harness, ".opencode", "agents", "researcher.md"), "---\nname: Researcher\n---\n");

  const runner = makeOpenCodeRunner({
    spawn: ({ workspaceDir, taskPrompt, timeoutMs, args }) => {
      assert.equal(workspaceDir, workspace);
      assert.equal(taskPrompt, "fix the task");
      assert.equal(timeoutMs, 1234);
      assert.equal(readFileSync(join(workspaceDir, "AGENTS.md"), "utf8"), "agent instructions\n");
      assert.equal(readFileSync(join(workspaceDir, "opencode.json"), "utf8"), '{ "model": "opencode/big-pickle" }\n');
      assert.equal(
        readFileSync(join(workspaceDir, ".opencode", "agents", "researcher.md"), "utf8"),
        "---\nname: Researcher\n---\n",
      );
      assert.deepEqual(args.slice(0, 7), [
        "run",
        "--format",
        "default",
        "--dir",
        workspaceDir,
        "--dangerously-skip-permissions",
        "--pure",
      ]);
      assert.equal(args.at(-1), "fix the task");
      return { status: 0, signal: null, stdout: "done\n", stderr: "" };
    },
  });

  const result = await runner({
    workspaceDir: workspace,
    taskPrompt: "fix the task",
    timeoutMs: 1234,
    harnessSource: harness,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "done");
  assert.equal(result.stderr, "");
});

test("opencode runner maps timeouts to exit code 124", async () => {
  const workspace = scratchDir();
  const runner = makeOpenCodeRunner({
    spawn: () => ({
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "timed out",
      error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    }),
  });

  const result = await runner({
    workspaceDir: workspace,
    taskPrompt: "long task",
  } satisfies RunnerContext);

  assert.equal(result.exitCode, 124);
  assert.equal(result.stderr, "timed out");
});

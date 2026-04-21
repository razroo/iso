import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCodexRunner } from "../src/runners/codex.js";
import type { RunnerContext } from "../src/types.js";

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "iso-eval-codex-"));
}

test("codex runner stages AGENTS.md and .codex/config.toml into the workspace", async () => {
  const workspace = scratchDir();
  const harness = scratchDir();
  mkdirSync(join(harness, ".codex"), { recursive: true });
  writeFileSync(join(harness, "AGENTS.md"), "agent instructions\n");
  writeFileSync(join(harness, ".codex", "config.toml"), 'model = "gpt-5.4"\n');

  const runner = makeCodexRunner({
    spawn: ({ workspaceDir, taskPrompt, outputFile, timeoutMs }) => {
      assert.equal(workspaceDir, workspace);
      assert.equal(taskPrompt, "fix the task");
      assert.equal(timeoutMs, 1234);
      assert.equal(readFileSync(join(workspaceDir, "AGENTS.md"), "utf8"), "agent instructions\n");
      assert.equal(
        readFileSync(join(workspaceDir, ".codex", "config.toml"), "utf8"),
        'model = "gpt-5.4"\n',
      );
      writeFileSync(outputFile, "done\n");
      return { status: 0, signal: null, stdout: "", stderr: "" };
    },
  });

  const result = await runner({
    workspaceDir: workspace,
    taskPrompt: "fix the task",
    timeoutMs: 1234,
    harnessSource: harness,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "done\n");
  assert.equal(result.stderr, "");
});

test("codex runner falls back to the JSON event stream when the last-message file is absent", async () => {
  const workspace = scratchDir();
  const runner = makeCodexRunner({
    spawn: () => ({
      status: 0,
      signal: null,
      stdout: [
        '{"type":"thread.started","thread_id":"abc"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hi"}}',
      ].join("\n"),
      stderr: "",
    }),
  });

  const result = await runner({
    workspaceDir: workspace,
    taskPrompt: "say hi",
  } satisfies RunnerContext);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hi");
});

test("codex runner maps timeouts to exit code 124", async () => {
  const workspace = scratchDir();
  const runner = makeCodexRunner({
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

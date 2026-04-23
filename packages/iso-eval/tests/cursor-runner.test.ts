import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCursorRunner } from "../src/runners/cursor.js";
import type { RunnerContext } from "../src/types.js";

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "iso-eval-cursor-"));
}

test("cursor runner stages .cursor rules and mcp config into the workspace", async () => {
  const workspace = scratchDir();
  const harness = scratchDir();
  mkdirSync(join(harness, ".cursor", "rules"), { recursive: true });
  writeFileSync(join(harness, ".cursor", "rules", "main.mdc"), "---\nalwaysApply: true\n---\nfollow the rules\n");
  writeFileSync(join(harness, ".cursor", "mcp.json"), '{ "mcpServers": {} }\n');

  const runner = makeCursorRunner({
    spawn: ({ workspaceDir, taskPrompt, timeoutMs, args }) => {
      assert.equal(workspaceDir, workspace);
      assert.equal(taskPrompt, "fix the task");
      assert.equal(timeoutMs, 1234);
      assert.equal(
        readFileSync(join(workspaceDir, ".cursor", "rules", "main.mdc"), "utf8"),
        "---\nalwaysApply: true\n---\nfollow the rules\n",
      );
      assert.equal(
        readFileSync(join(workspaceDir, ".cursor", "mcp.json"), "utf8"),
        '{ "mcpServers": {} }\n',
      );
      assert.deepEqual(
        args.slice(0, 8),
        ["--print", "--output-format", "text", "--workspace", workspaceDir, "--force", "--trust", "--approve-mcps"],
      );
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

test("cursor runner maps timeouts to exit code 124", async () => {
  const workspace = scratchDir();
  const runner = makeCursorRunner({
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

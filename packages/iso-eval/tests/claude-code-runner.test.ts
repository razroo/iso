import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeClaudeCodeRunner } from "../src/runners/claude-code.js";
import type { RunnerContext } from "../src/types.js";

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "iso-eval-claude-code-"));
}

test("claude-code runner stages CLAUDE.md, .claude/settings.json, and .mcp.json into the workspace", async () => {
  const workspace = scratchDir();
  const harness = scratchDir();
  mkdirSync(join(harness, ".claude"), { recursive: true });
  writeFileSync(join(harness, "CLAUDE.md"), "claude instructions\n");
  writeFileSync(join(harness, ".claude", "settings.json"), '{ "model": "claude-sonnet-4-6" }\n');
  writeFileSync(join(harness, ".mcp.json"), '{ "servers": {} }\n');

  const runner = makeClaudeCodeRunner({
    spawn: ({ workspaceDir, taskPrompt, timeoutMs, args }) => {
      assert.equal(workspaceDir, workspace);
      assert.equal(taskPrompt, "fix the task");
      assert.equal(timeoutMs, 1234);
      assert.equal(readFileSync(join(workspaceDir, "CLAUDE.md"), "utf8"), "claude instructions\n");
      assert.equal(
        readFileSync(join(workspaceDir, ".claude", "settings.json"), "utf8"),
        '{ "model": "claude-sonnet-4-6" }\n',
      );
      assert.equal(readFileSync(join(workspaceDir, ".mcp.json"), "utf8"), '{ "servers": {} }\n');
      assert.deepEqual(
        args.slice(0, 8),
        ["-p", "--no-session-persistence", "--output-format", "text", "--permission-mode", "bypassPermissions", "--setting-sources", "project,local"],
      );
      assert.ok(args.includes("--strict-mcp-config"));
      assert.ok(args.includes("--mcp-config"));
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

test("claude-code runner maps timeouts to exit code 124", async () => {
  const workspace = scratchDir();
  const runner = makeClaudeCodeRunner({
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

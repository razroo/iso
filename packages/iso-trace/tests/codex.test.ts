import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodex } from "../src/sources/codex.js";
import { loadSessionFromPath, refFromPath } from "../src/sources/index.js";
import type { FileOpEvent, ToolCallEvent, ToolResultEvent } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures/codex/sample.jsonl");

test("parses the sample Codex transcript into a session", () => {
  const s = parseCodex(FIXTURE);
  assert.equal(s.id, "codex-session-1");
  assert.equal(s.source.harness, "codex");
  assert.equal(s.source.format, "codex/jsonl-v1");
  assert.equal(s.cwd, "/tmp/codex-project");
  assert.equal(s.model, "gpt-5.4");
  assert.equal(s.startedAt, "2026-04-19T15:00:00.000Z");
  assert.equal(s.endedAt, "2026-04-19T15:00:04.500Z");
  assert.equal(s.durationMs, 4500);
  assert.equal(s.turns.length, 7);
  assert.equal(s.tokenUsage.input, 11);
  assert.equal(s.tokenUsage.output, 7);
  assert.equal(s.tokenUsage.cacheRead, 3);
  assert.equal(s.tokenUsage.cacheCreated, 0);
});

test("loadSessionFromPath and refFromPath infer Codex from the transcript contents", () => {
  const s = loadSessionFromPath(FIXTURE);
  const ref = refFromPath(FIXTURE);
  assert.equal(s.source.harness, "codex");
  assert.equal(ref.source.harness, "codex");
  assert.equal(ref.id, "codex-session-1");
});

test("Codex tool calls, tool results, and file ops are preserved", () => {
  const s = parseCodex(FIXTURE);
  const events = s.turns.flatMap((t) => t.events);
  const calls = events.filter((e): e is ToolCallEvent => e.kind === "tool_call");
  const results = events.filter((e): e is ToolResultEvent => e.kind === "tool_result");
  const ops = events.filter((e): e is FileOpEvent => e.kind === "file_op");

  assert.equal(calls.length, 2);
  assert.equal(results.length, 2);
  assert.deepEqual(
    ops.map((op) => ({ op: op.op, path: op.path, tool: op.tool })),
    [
      { op: "read", path: "/tmp/codex-project/src/app.ts", tool: "exec_command" },
      { op: "edit", path: "src/app.ts", tool: "apply_patch" },
      { op: "write", path: "notes.txt", tool: "apply_patch" },
    ],
  );
});

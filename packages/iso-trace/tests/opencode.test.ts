import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpenCode } from "../src/sources/opencode.js";
import { loadSessionFromPath, refFromPath } from "../src/sources/index.js";
import type { FileOpEvent, ToolCallEvent, ToolResultEvent } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures/opencode/sample.json");

test("parses the sample OpenCode export into a session", () => {
  const s = parseOpenCode(FIXTURE);
  assert.equal(s.id, "ses_demo123");
  assert.equal(s.source.harness, "opencode");
  assert.equal(s.source.format, "opencode/export-json-v1");
  assert.equal(s.cwd, "/tmp/opencode-project");
  assert.equal(s.model, "openai/gpt-5-mini");
  assert.equal(s.startedAt, "2026-04-19T16:00:00.000Z");
  assert.equal(s.endedAt, "2026-04-19T16:00:04.000Z");
  assert.equal(s.durationMs, 4000);
  assert.equal(s.tokenUsage.input, 13);
  assert.equal(s.tokenUsage.output, 9);
  assert.equal(s.tokenUsage.cacheRead, 2);
  assert.equal(s.tokenUsage.cacheCreated, 1);
});

test("loadSessionFromPath and refFromPath infer OpenCode from the export contents", () => {
  const s = loadSessionFromPath(FIXTURE);
  const ref = refFromPath(FIXTURE);
  assert.equal(s.source.harness, "opencode");
  assert.equal(ref.source.harness, "opencode");
  assert.equal(ref.id, "ses_demo123");
});

test("OpenCode tool parts, patch parts, and assistant errors become events", () => {
  const s = parseOpenCode(FIXTURE);
  const events = s.turns.flatMap((t) => t.events);
  const calls = events.filter((e): e is ToolCallEvent => e.kind === "tool_call");
  const results = events.filter((e): e is ToolResultEvent => e.kind === "tool_result");
  const ops = events.filter((e): e is FileOpEvent => e.kind === "file_op");
  const messages = events.filter((e): e is Extract<typeof e, { kind: "message" }> => e.kind === "message");

  assert.equal(calls.length, 3);
  assert.equal(results.length, 3);
  assert.deepEqual(
    ops.map((op) => ({ op: op.op, path: op.path, tool: op.tool })),
    [
      { op: "read", path: "src/main.ts", tool: "read" },
      { op: "search", path: "TODO", tool: "grep" },
      { op: "list", path: "src/**/*.ts", tool: "glob" },
      { op: "edit", path: "src/main.ts", tool: "patch" },
      { op: "edit", path: "README.md", tool: "patch" },
    ],
  );
  assert.ok(messages.some((m) => m.text === "Fixed the TODO and updated the docs."));
  assert.ok(messages.some((m) => m.text === "Error: tool failed"));
});

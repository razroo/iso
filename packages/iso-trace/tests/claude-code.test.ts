import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeCode } from "../src/sources/claude-code.js";
import { loadSessionFromPath } from "../src/sources/index.js";
import type { FileOpEvent, ToolCallEvent, ToolResultEvent } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures/claude-code/sample.jsonl");

test("parses the sample transcript into a session", () => {
  const s = parseClaudeCode(FIXTURE);
  assert.equal(s.source.harness, "claude-code");
  assert.equal(s.source.format, "claude-code/jsonl-v1");
  assert.equal(s.cwd, "/tmp/sample-project");
  assert.equal(s.model, "claude-opus-4-7");
  assert.equal(s.startedAt, "2026-04-18T10:00:00.000Z");
  assert.equal(s.endedAt, "2026-04-18T10:00:05.000Z");
  assert.equal(s.durationMs, 5000);
  assert.ok(s.turns.length >= 5, `expected ≥5 turns, got ${s.turns.length}`);
});

test("generic loader infers claude-code when a metadata record appears first", () => {
  const s = loadSessionFromPath(FIXTURE);
  assert.equal(s.source.harness, "claude-code");
  assert.equal(s.startedAt, "2026-04-18T10:00:00.000Z");
});

test("token usage sums across all assistant turns", () => {
  const s = parseClaudeCode(FIXTURE);
  assert.equal(s.tokenUsage.input, 42 + 8 + 6 + 5);
  assert.equal(s.tokenUsage.output, 17 + 22 + 14 + 19);
  assert.equal(s.tokenUsage.cacheRead, 100 + 150 + 170 + 180);
  assert.equal(s.tokenUsage.cacheCreated, 50);
});

test("thinking blocks are dropped; text and tool_use blocks are kept", () => {
  const s = parseClaudeCode(FIXTURE);
  const events = s.turns.flatMap((t) => t.events);
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("message"));
  assert.ok(kinds.includes("tool_call"));
  assert.ok(kinds.includes("tool_result"));
  assert.ok(kinds.includes("file_op"));
  assert.ok(kinds.includes("token_usage"));
  // No leaked thinking content
  const messages = events.filter((e): e is Extract<typeof e, { kind: "message" }> => e.kind === "message");
  for (const m of messages) assert.ok(!m.text.includes("private"), "thinking content must not leak");
});

test("file_op events are derived from Read/Edit tool_use (Bash is not a file op)", () => {
  const s = parseClaudeCode(FIXTURE);
  const ops = s.turns
    .flatMap((t) => t.events)
    .filter((e): e is FileOpEvent => e.kind === "file_op");
  assert.equal(ops.length, 2);
  assert.deepEqual(
    ops.map((o) => ({ op: o.op, path: o.path, tool: o.tool })),
    [
      { op: "read", path: "/tmp/sample-project/README.md", tool: "Read" },
      { op: "edit", path: "/tmp/sample-project/README.md", tool: "Edit" },
    ],
  );
});

test("tool_result events pair with their tool_use ids", () => {
  const s = parseClaudeCode(FIXTURE);
  const calls = s.turns
    .flatMap((t) => t.events)
    .filter((e): e is ToolCallEvent => e.kind === "tool_call");
  const results = s.turns
    .flatMap((t) => t.events)
    .filter((e): e is ToolResultEvent => e.kind === "tool_result");
  const callIds = new Set(calls.map((c) => c.id));
  for (const r of results) assert.ok(callIds.has(r.toolUseId), `orphan tool_result ${r.toolUseId}`);
});

test("session id is deterministic for the same path+contents", () => {
  const a = parseClaudeCode(FIXTURE);
  const b = parseClaudeCode(FIXTURE);
  assert.equal(a.id, b.id);
  assert.match(a.id, /^cc_[a-z0-9]+_[a-f0-9]{8}$/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCursor } from "../src/sources/cursor.js";
import { loadSessionFromPath } from "../src/sources/index.js";
import type { FileOpEvent, ToolCallEvent } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(
  here,
  "fixtures/cursor/.cursor/projects/Users-demo-cursor-project/agent-transcripts/9e6f0c7a-1111-4222-8333-abcdefabcdef/9e6f0c7a-1111-4222-8333-abcdefabcdef.jsonl",
);

test("parses the sample Cursor transcript into a session", () => {
  const s = parseCursor(FIXTURE);
  assert.equal(s.source.harness, "cursor");
  assert.equal(s.source.format, "cursor/jsonl-v1");
  assert.equal(s.cwd, "/tmp/cursor-project");
  assert.ok(Number.isFinite(Date.parse(s.startedAt)));
  assert.ok(s.endedAt && Number.isFinite(Date.parse(s.endedAt)));
  assert.ok(s.durationMs >= 0);
  assert.equal(s.turns.length, 7);
  assert.equal(s.tokenUsage.input, 0);
  assert.equal(s.tokenUsage.output, 0);
});

test("generic loader infers cursor from Cursor transcript paths", () => {
  const s = loadSessionFromPath(FIXTURE);
  assert.equal(s.source.harness, "cursor");
  assert.equal(s.cwd, "/tmp/cursor-project");
});

test("Cursor tool_use blocks become tool calls and derived file ops", () => {
  const s = parseCursor(FIXTURE);
  const calls = s.turns.flatMap((turn) => turn.events).filter((event): event is ToolCallEvent => event.kind === "tool_call");
  const ops = s.turns.flatMap((turn) => turn.events).filter((event): event is FileOpEvent => event.kind === "file_op");

  assert.equal(calls.length, 7);
  assert.deepEqual(
    ops.map((op) => ({ op: op.op, path: op.path, tool: op.tool })),
    [
      { op: "list", path: "/tmp/cursor-project/src/**/*.ts", tool: "Glob" },
      { op: "read", path: "/tmp/cursor-project/README.md", tool: "Read" },
      { op: "search", path: "/tmp/cursor-project", tool: "Grep" },
      { op: "edit", path: "/tmp/cursor-project/README.md", tool: "StrReplace" },
      { op: "write", path: "/tmp/cursor-project/CHANGELOG.md", tool: "ApplyPatch" },
      { op: "edit", path: "/tmp/cursor-project/src/app.ts", tool: "ApplyPatch" },
      { op: "write", path: "/tmp/cursor-project/notes.txt", tool: "Write" },
      { op: "read", path: "/tmp/cursor-project/src/app.ts", tool: "ReadLints" },
    ],
  );
});

test("session id is deterministic for the same Cursor transcript", () => {
  const a = parseCursor(FIXTURE);
  const b = parseCursor(FIXTURE);
  assert.equal(a.id, b.id);
  assert.match(a.id, /^cu_[a-f0-9]{8}_[a-f0-9]{8}$/);
});

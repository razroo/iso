import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportFixture } from "../src/fixture.js";
import type { Session } from "../src/types.js";

function mkSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess_test",
    source: { harness: "claude-code", format: "jsonl-v1", path: "/tmp/sess.jsonl" },
    cwd: "/work/proj",
    startedAt: "2026-04-20T10:00:00Z",
    durationMs: 5000,
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 },
    turns: [
      {
        index: 0,
        role: "user",
        at: "2026-04-20T10:00:00Z",
        events: [
          { kind: "message", role: "user", text: "Write a README about foo." },
        ],
      },
      {
        index: 1,
        role: "assistant",
        at: "2026-04-20T10:00:02Z",
        events: [
          { kind: "file_op", op: "read", path: "/work/proj/src/foo.ts", tool: "Read" },
          { kind: "file_op", op: "write", path: "/work/proj/README.md", tool: "Write" },
          { kind: "file_op", op: "edit", path: "/work/proj/src/foo.ts", tool: "Edit" },
        ],
      },
    ],
    ...overrides,
  };
}

function mkOut(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "iso-trace-fixture-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

test("exportFixture: extracts first user message into task.md", () => {
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(mkSession(), { out: path });
    const task = readFileSync(result.taskMdPath, "utf8");
    assert.ok(task.includes("Write a README about foo."));
    assert.ok(task.includes("exported from iso-trace session sess_test"));
  } finally {
    cleanup();
  }
});

test("exportFixture: seeds workspace/ with empty placeholders for files the agent read", () => {
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(mkSession(), { out: path });
    const seeded = join(result.workspaceDir, "src", "foo.ts");
    assert.ok(existsSync(seeded), `expected seeded file at ${seeded}`);
    assert.equal(readFileSync(seeded, "utf8"), "");
  } finally {
    cleanup();
  }
});

test("exportFixture: emits file_exists per write and file_exists + file_contains per edit", () => {
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(mkSession(), { out: path });
    const yml = readFileSync(result.checksYmlPath, "utf8");
    assert.match(yml, /file_exists, path: README\.md/);
    assert.match(yml, /file_exists, path: src\/foo\.ts/);
    assert.match(yml, /file_contains, path: src\/foo\.ts, value: "REPLACE_ME"/);
    assert.match(yml, /runner: fake/);
    assert.match(yml, /suite: fixture-sess_test/);
  } finally {
    cleanup();
  }
});

test("exportFixture: absolute paths outside cwd are kept verbatim, not silently dropped", () => {
  const session = mkSession({
    turns: [
      {
        index: 0,
        role: "user",
        at: "2026-04-20T10:00:00Z",
        events: [{ kind: "message", role: "user", text: "hi" }],
      },
      {
        index: 1,
        role: "assistant",
        at: "2026-04-20T10:00:02Z",
        events: [
          { kind: "file_op", op: "write", path: "/etc/hosts", tool: "Write" },
        ],
      },
    ],
  });
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(session, { out: path });
    const yml = readFileSync(result.checksYmlPath, "utf8");
    // The absolute path doesn't fit in cwd — it's still recorded so the
    // maintainer can see it, just not rewritten to a relative. Valid YAML
    // path scalars don't need quotes when they only contain [a-zA-Z0-9_-./].
    assert.match(yml, /file_exists, path: \/etc\/hosts/);
  } finally {
    cleanup();
  }
});

test("exportFixture: session with no file ops emits a helpful note in checks.yml", () => {
  const session = mkSession({
    turns: [
      {
        index: 0,
        role: "user",
        at: "2026-04-20T10:00:00Z",
        events: [{ kind: "message", role: "user", text: "Just answer, no file writes." }],
      },
    ],
  });
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(session, { out: path });
    const yml = readFileSync(result.checksYmlPath, "utf8");
    assert.match(yml, /No file writes or edits observed/);
    assert.equal(result.writtenFiles.length, 0);
    assert.equal(result.editedFiles.length, 0);
  } finally {
    cleanup();
  }
});

test("exportFixture: session without a user message produces a TODO placeholder task.md", () => {
  const session = mkSession({
    turns: [
      {
        index: 0,
        role: "assistant",
        at: "2026-04-20T10:00:00Z",
        events: [{ kind: "message", role: "assistant", text: "hello" }],
      },
    ],
  });
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(session, { out: path });
    const task = readFileSync(result.taskMdPath, "utf8");
    assert.match(task, /TODO: no user message found/);
  } finally {
    cleanup();
  }
});

test("exportFixture: fixture output directory layout is stable", () => {
  const { path, cleanup } = mkOut();
  try {
    const result = exportFixture(mkSession(), { out: path });
    const top = readdirSync(result.outDir).sort();
    assert.deepEqual(top, ["checks.yml", "task.md", "workspace"]);
  } finally {
    cleanup();
  }
});

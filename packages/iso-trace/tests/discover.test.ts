import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, parseSinceCutoff } from "../src/discover.js";
import { defaultOpenCodeDbPath, sessionRefsFromOpenCodeRows } from "../src/sources/opencode.js";

const here = dirname(fileURLToPath(import.meta.url));
const CODEX_FIXTURE = resolve(here, "fixtures/codex/sample.jsonl");

test("parseSinceCutoff: relative and ISO forms", () => {
  const rel = parseSinceCutoff("7d");
  assert.ok(typeof rel === "number" && rel < Date.now());
  const abs = parseSinceCutoff("2026-04-01T00:00:00Z");
  assert.equal(abs, Date.parse("2026-04-01T00:00:00Z"));
  assert.equal(parseSinceCutoff(undefined), undefined);
  assert.throws(() => parseSinceCutoff("not-a-time"), /unrecognised/);
});

test("discoverSessions with an explicit root picks up .jsonl files", async () => {
  const base = mkdtempSync(join(tmpdir(), "iso-trace-disc-"));
  const fakeRoot = join(base, ".claude", "projects");
  const projectDir = join(fakeRoot, "-tmp-demo-project");
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, "sess-1.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-04-18T09:00:00.000Z",
        cwd: "/tmp/demo-project",
        sessionId: "sess-1",
        message: { role: "user", content: "hi" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-18T09:00:01.000Z",
        cwd: "/tmp/demo-project",
        sessionId: "sess-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
    ].join("\n") + "\n",
  );
  try {
    const refs = await discoverSessions({ roots: [fakeRoot] });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].cwd, "/tmp/demo-project");
    assert.equal(refs[0].turnCount, 2);
    const none = await discoverSessions({ roots: [fakeRoot], cwd: "/nowhere" });
    assert.equal(none.length, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("discoverSessions with a Codex root picks up .jsonl files", async () => {
  const base = mkdtempSync(join(tmpdir(), "iso-trace-disc-codex-"));
  const fakeRoot = join(base, ".codex", "sessions");
  const projectDir = join(fakeRoot, "tmp-demo-project");
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, "sess-1.jsonl");
  writeFileSync(file, readFileSync(CODEX_FIXTURE, "utf8"));
  try {
    const refs = await discoverSessions({ roots: [fakeRoot] });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].source.harness, "codex");
    assert.equal(refs[0].id, "codex-session-1");
    assert.equal(refs[0].cwd, "/tmp/codex-project");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("discoverSessions with a Cursor root picks up agent transcripts", async () => {
  const base = mkdtempSync(join(tmpdir(), "iso-trace-disc-cursor-"));
  const fakeRoot = join(base, ".cursor", "projects");
  const projectDir = join(fakeRoot, "Users-demo-cursor-project");
  const sessionId = "11111111-2222-4333-8444-555555555555";
  const transcriptDir = join(projectDir, "agent-transcripts", sessionId);
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(
    join(projectDir, ".workspace-trusted"),
    JSON.stringify({
      trustedAt: "2026-04-22T10:00:00.000Z",
      workspacePath: "/tmp/cursor-project",
    }, null, 2) + "\n",
  );
  writeFileSync(
    join(transcriptDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { path: "/tmp/cursor-project/README.md" } }],
        },
      }),
    ].join("\n") + "\n",
  );
  try {
    const refs = await discoverSessions({ roots: [fakeRoot] });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].source.harness, "cursor");
    assert.equal(refs[0].cwd, "/tmp/cursor-project");
    assert.equal(refs[0].turnCount, 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("sessionRefsFromOpenCodeRows converts sqlite rows into session refs", () => {
  const refs = sessionRefsFromOpenCodeRows(
    [
      {
        id: "ses_older",
        directory: "/tmp/older",
        time_created: 1776614300000,
        time_updated: 1776614302000,
        turn_count: 2,
        size_bytes: 120,
      },
      {
        id: "ses_newer",
        directory: "/tmp/newer",
        time_created: 1776614400000,
        time_updated: 1776614404000,
        turn_count: 5,
        size_bytes: 320,
      },
    ],
    defaultOpenCodeDbPath(),
  );

  assert.equal(refs.length, 2);
  assert.equal(refs[0].id, "ses_newer");
  assert.equal(refs[0].source.harness, "opencode");
  assert.match(refs[0].source.path, /opencode\.db#session=ses_newer$/);
  assert.equal(refs[0].turnCount, 5);
  assert.equal(refs[0].sizeBytes, 320);
});

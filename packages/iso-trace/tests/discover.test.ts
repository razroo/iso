import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSessions, parseSinceCutoff } from "../src/discover.js";

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

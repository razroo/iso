import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeCode } from "../src/sources/claude-code.js";
import { exportSession } from "../src/export.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures/claude-code/sample.jsonl");

test("json export round-trips session metadata", () => {
  const s = parseClaudeCode(FIXTURE);
  const out = exportSession(s, "json");
  const parsed = JSON.parse(out);
  assert.equal(parsed.id, s.id);
  assert.equal(parsed.source.harness, "claude-code");
  assert.equal(parsed.model, "claude-opus-4-7");
  assert.equal(parsed.turns.length, s.turns.length);
});

test("jsonl export emits one session header + one line per event", () => {
  const s = parseClaudeCode(FIXTURE);
  const out = exportSession(s, "jsonl");
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].type, "session");
  assert.equal(lines[0].id, s.id);
  assert.ok(!lines[0].turns, "session header must omit the turns array");
  const eventLines = lines.slice(1);
  const totalEvents = s.turns.reduce((n, t) => n + t.events.length, 0);
  assert.equal(eventLines.length, totalEvents);
  for (const line of eventLines) {
    assert.equal(line.type, "event");
    assert.ok(typeof line.turnIndex === "number");
    assert.ok(typeof line.role === "string");
    assert.ok(typeof line.at === "string");
    assert.ok(typeof line.kind === "string");
  }
});

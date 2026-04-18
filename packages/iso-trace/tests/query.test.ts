import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeCode } from "../src/sources/claude-code.js";
import { filter, findSessionById, iterateEvents, stats } from "../src/query.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures/claude-code/sample.jsonl");

test("iterateEvents walks every event with turn metadata", () => {
  const s = parseClaudeCode(FIXTURE);
  const all = [...iterateEvents(s)];
  assert.ok(all.length > 0);
  for (const item of all) {
    assert.ok(typeof item.turnIndex === "number");
    assert.ok(item.event && typeof item.event.kind === "string");
  }
});

test("filter picks only matching events", () => {
  const s = parseClaudeCode(FIXTURE);
  const toolCalls = filter(s, (e) => e.kind === "tool_call");
  assert.equal(toolCalls.length, 3);
  const bashCalls = filter(
    s,
    (e) => e.kind === "tool_call" && (e as { name: string }).name === "Bash",
  );
  assert.equal(bashCalls.length, 1);
});

test("stats aggregates tool and file_op counts across sessions", () => {
  const s = parseClaudeCode(FIXTURE);
  const result = stats([s]);
  assert.equal(result.sessions, 1);
  assert.equal(result.toolCalls.Read, 1);
  assert.equal(result.toolCalls.Edit, 1);
  assert.equal(result.toolCalls.Bash, 1);
  assert.equal(result.fileOps.read, 1);
  assert.equal(result.fileOps.edit, 1);
  assert.equal(result.fileOps.write, undefined);
  assert.deepEqual(result.filesTouched.read, ["/tmp/sample-project/README.md"]);
  assert.deepEqual(result.filesTouched.edited, ["/tmp/sample-project/README.md"]);
});

test("findSessionById: exact match, prefix match, ambiguous prefix", () => {
  const refs = [
    { id: "cc_abcd1234_deadbeef" },
    { id: "cc_abcd5678_cafef00d" },
    { id: "cc_wxyz9999_01234567" },
  ];
  assert.equal(findSessionById(refs, "cc_abcd1234_deadbeef")!.id, "cc_abcd1234_deadbeef");
  assert.equal(findSessionById(refs, "cc_wxyz")!.id, "cc_wxyz9999_01234567");
  assert.equal(findSessionById(refs, "cc_nope"), undefined);
  assert.throws(() => findSessionById(refs, "cc_abcd"), /matches 2 sessions/);
});

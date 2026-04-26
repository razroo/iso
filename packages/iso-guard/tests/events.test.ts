import assert from "node:assert/strict";
import test from "node:test";

import { parseEventsText } from "../src/events.js";

test("parses normalized event JSON", () => {
  const events = parseEventsText(JSON.stringify([
    { type: "tool_call", name: "task", data: { round: 1 } },
  ]));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "tool_call");
  assert.equal(events[0]?.name, "task");
  assert.equal(events[0]?.index, 0);
});

test("parses normalized event JSONL", () => {
  const events = parseEventsText([
    JSON.stringify({ type: "tool_call", name: "task" }),
    JSON.stringify({ type: "tool_call", name: "merge" }),
  ].join("\n"));

  assert.equal(events.length, 2);
  assert.equal(events[1]?.name, "merge");
});

test("flattens iso-trace JSON session exports", () => {
  const events = parseEventsText(JSON.stringify({
    id: "session-1",
    turns: [
      {
        index: 0,
        role: "assistant",
        at: "2026-04-26T00:00:00Z",
        events: [
          { kind: "tool_call", id: "t1", name: "task", input: { prompt: "apply" } },
          { kind: "message", role: "assistant", text: "done" },
        ],
      },
    ],
  }));

  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "tool_call");
  assert.equal(events[0]?.name, "task");
  assert.equal(events[0]?.data?.turnIndex, 0);
  assert.match(events[0]?.text ?? "", /apply/);
});

test("flattens iso-trace JSONL event exports and ignores session header", () => {
  const events = parseEventsText([
    JSON.stringify({ type: "session", id: "session-1" }),
    JSON.stringify({ type: "event", kind: "tool_call", turnIndex: 1, at: "now", name: "geometra_disconnect", input: {} }),
  ].join("\n"));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "tool_call");
  assert.equal(events[0]?.name, "geometra_disconnect");
});

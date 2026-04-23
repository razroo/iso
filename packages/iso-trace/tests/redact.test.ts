import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor, redactSession } from "../src/redact.js";
import type { Session } from "../src/types.js";

function session(): Session {
  return {
    id: "sess_test",
    source: {
      harness: "codex",
      format: "jsonl-v1",
      path: "/Users/alice/.codex/sessions/session.jsonl",
    },
    cwd: "/Users/alice/work/proj",
    startedAt: "2026-04-20T10:00:00.000Z",
    durationMs: 1000,
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 },
    turns: [
      {
        index: 0,
        role: "user",
        at: "2026-04-20T10:00:00.000Z",
        events: [
          {
            kind: "message",
            role: "user",
            text: "Read /Users/alice/work/proj/src/main.ts and use sk-1234567890abcdefghijkl",
          },
        ],
      },
      {
        index: 1,
        role: "assistant",
        at: "2026-04-20T10:00:01.000Z",
        events: [
          {
            kind: "tool_call",
            id: "tool_1",
            name: "Read",
            input: {
              path: "/Users/alice/work/proj/src/main.ts",
              token: "ghp_abcdefghijklmnopqrstuvwxyz123456",
            },
          },
        ],
      },
    ],
  };
}

test("redactSession scrubs source paths, cwd paths, and common secret shapes", () => {
  const redacted = redactSession(session());
  assert.equal(redacted.source.path, "<SOURCE_PATH>");
  const msg = redacted.turns[0].events[0];
  assert.equal(msg.kind, "message");
  assert.equal(msg.text, "Read ./src/main.ts and use <SECRET:OPENAI_KEY>");
  const tool = redacted.turns[1].events[0];
  assert.equal(tool.kind, "tool_call");
  assert.deepEqual(tool.input, {
    path: "./src/main.ts",
    token: "<SECRET:GITHUB_TOKEN>",
  });
});

test("createRedactor applies custom denylist regexes", () => {
  const redactor = createRedactor(session(), {
    patterns: [/alice@example\.com/g],
  });
  assert.equal(redactor.text("contact alice@example.com"), "contact <REDACTED>");
});

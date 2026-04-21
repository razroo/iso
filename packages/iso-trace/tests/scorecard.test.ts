import { test } from "node:test";
import assert from "node:assert/strict";
import { modelScorecard, modelScorecardFromOpenCodeRows } from "../src/scorecard.js";
import type { Session } from "../src/types.js";

test("modelScorecard groups tool outcomes by the model that made the call", () => {
  const session: Session = {
    id: "s1",
    source: { harness: "opencode", format: "opencode/export-json-v1", path: "/tmp/session.json" },
    cwd: "/tmp/project",
    startedAt: "2026-04-20T00:00:00.000Z",
    durationMs: 1000,
    turns: [
      {
        index: 0,
        role: "assistant",
        at: "2026-04-20T00:00:00.000Z",
        events: [
          { kind: "tool_call", id: "call_bad", name: "read", input: { path: "config/profile.yml" } },
          { kind: "token_usage", input: 1, output: 1, cacheRead: 0, cacheCreated: 0, model: "openrouter/minimax/minimax-m2.5:free" },
        ],
      },
      {
        index: 1,
        role: "tool",
        at: "2026-04-20T00:00:01.000Z",
        events: [
          {
            kind: "tool_result",
            toolUseId: "call_bad",
            output: "",
            error:
              'The read tool was called with invalid arguments: [{"path":["filePath"],"message":"Invalid input: expected string, received undefined"}]',
          },
        ],
      },
      {
        index: 2,
        role: "assistant",
        at: "2026-04-20T00:00:02.000Z",
        events: [
          { kind: "tool_call", id: "call_ok", name: "read", input: { filePath: "config/profile.yml" } },
          { kind: "token_usage", input: 1, output: 1, cacheRead: 0, cacheCreated: 0, model: "openrouter/z-ai/glm-4.5-air:free" },
        ],
      },
      {
        index: 3,
        role: "tool",
        at: "2026-04-20T00:00:03.000Z",
        events: [{ kind: "tool_result", toolUseId: "call_ok", output: "ok" }],
      },
    ],
    tokenUsage: { input: 2, output: 2, cacheRead: 0, cacheCreated: 0 },
  };

  const scores = modelScorecard([session], { tool: "read" });
  assert.equal(scores.length, 2);

  const minimax = scores.find((score) => score.model === "openrouter/minimax/minimax-m2.5:free");
  const glm = scores.find((score) => score.model === "openrouter/z-ai/glm-4.5-air:free");

  assert.ok(minimax);
  assert.equal(minimax.sessions, 1);
  assert.equal(minimax.calls, 1);
  assert.equal(minimax.completed, 0);
  assert.equal(minimax.errors, 1);
  assert.equal(minimax.schemaErrors, 1);
  assert.equal(minimax.readInputShapes.path, 1);

  assert.ok(glm);
  assert.equal(glm.sessions, 1);
  assert.equal(glm.calls, 1);
  assert.equal(glm.completed, 1);
  assert.equal(glm.errors, 0);
  assert.equal(glm.schemaErrors, 0);
  assert.equal(glm.readInputShapes.filePath, 1);
});

test("modelScorecard filters by tool name", () => {
  const session: Session = {
    id: "s2",
    source: { harness: "opencode", format: "opencode/export-json-v1", path: "/tmp/session-2.json" },
    cwd: "/tmp/project",
    startedAt: "2026-04-20T01:00:00.000Z",
    durationMs: 1000,
    turns: [
      {
        index: 0,
        role: "assistant",
        at: "2026-04-20T01:00:00.000Z",
        events: [
          { kind: "tool_call", id: "read_1", name: "read", input: { filePath: "a.txt" } },
          { kind: "tool_call", id: "glob_1", name: "glob", input: { pattern: "**/*.ts" } },
          { kind: "token_usage", input: 1, output: 1, cacheRead: 0, cacheCreated: 0, model: "opencode/big-pickle" },
        ],
      },
      {
        index: 1,
        role: "tool",
        at: "2026-04-20T01:00:01.000Z",
        events: [
          { kind: "tool_result", toolUseId: "read_1", output: "ok" },
          { kind: "tool_result", toolUseId: "glob_1", output: "ok" },
        ],
      },
    ],
    tokenUsage: { input: 1, output: 1, cacheRead: 0, cacheCreated: 0 },
  };

  const scores = modelScorecard([session], { tool: "read" });
  assert.equal(scores.length, 1);
  assert.equal(scores[0].calls, 1);
  assert.equal(scores[0].completed, 1);
  assert.equal(scores[0].readInputShapes.filePath, 1);
});

test("modelScorecard filters calls by turn timestamp when sinceMs is set", () => {
  const session: Session = {
    id: "s3",
    source: { harness: "opencode", format: "opencode/export-json-v1", path: "/tmp/session-3.json" },
    cwd: "/tmp/project",
    startedAt: "2026-04-20T02:00:00.000Z",
    durationMs: 1000,
    turns: [
      {
        index: 0,
        role: "assistant",
        at: "2026-04-20T02:00:00.000Z",
        events: [
          { kind: "tool_call", id: "old_read", name: "read", input: { path: "old.txt" } },
          { kind: "token_usage", input: 1, output: 1, cacheRead: 0, cacheCreated: 0, model: "openrouter/minimax/minimax-m2.5:free" },
        ],
      },
      {
        index: 1,
        role: "tool",
        at: "2026-04-20T02:00:01.000Z",
        events: [{ kind: "tool_result", toolUseId: "old_read", output: "", error: "Invalid input: expected string, received undefined" }],
      },
      {
        index: 2,
        role: "assistant",
        at: "2026-04-20T02:10:00.000Z",
        events: [
          { kind: "tool_call", id: "new_read", name: "read", input: { filePath: "new.txt" } },
          { kind: "token_usage", input: 1, output: 1, cacheRead: 0, cacheCreated: 0, model: "opencode/big-pickle" },
        ],
      },
      {
        index: 3,
        role: "tool",
        at: "2026-04-20T02:10:01.000Z",
        events: [{ kind: "tool_result", toolUseId: "new_read", output: "ok" }],
      },
    ],
    tokenUsage: { input: 2, output: 2, cacheRead: 0, cacheCreated: 0 },
  };

  const scores = modelScorecard([session], {
    tool: "read",
    sinceMs: Date.parse("2026-04-20T02:05:00.000Z"),
  });

  assert.equal(scores.length, 1);
  assert.equal(scores[0].model, "opencode/big-pickle");
  assert.equal(scores[0].calls, 1);
  assert.equal(scores[0].completed, 1);
  assert.equal(scores[0].readInputShapes.filePath, 1);
});

test("modelScorecardFromOpenCodeRows scores provider/model pairs without replaying session exports", () => {
  const scores = modelScorecardFromOpenCodeRows(
    [
      {
        session_id: "ses_bad",
        time_created: Date.parse("2026-04-20T00:00:00.000Z"),
        providerID: "openrouter",
        modelID: "minimax/minimax-m2.5:free",
        tool: "read",
        status: "error",
        error: "Invalid input: expected string, received undefined",
        path: "config/profile.yml",
      },
      {
        session_id: "ses_ok",
        time_created: Date.parse("2026-04-20T00:00:01.000Z"),
        providerID: "openrouter",
        modelID: "z-ai/glm-4.5-air:free",
        tool: "read",
        status: "completed",
        filePath: "config/profile.yml",
      },
    ],
    { tool: "read" },
  );

  assert.equal(scores.length, 2);

  const minimax = scores.find((score) => score.model === "openrouter/minimax/minimax-m2.5:free");
  const glm = scores.find((score) => score.model === "openrouter/z-ai/glm-4.5-air:free");

  assert.ok(minimax);
  assert.equal(minimax.sessions, 1);
  assert.equal(minimax.calls, 1);
  assert.equal(minimax.completed, 0);
  assert.equal(minimax.errors, 1);
  assert.equal(minimax.schemaErrors, 1);
  assert.equal(minimax.readInputShapes.path, 1);

  assert.ok(glm);
  assert.equal(glm.sessions, 1);
  assert.equal(glm.calls, 1);
  assert.equal(glm.completed, 1);
  assert.equal(glm.errors, 0);
  assert.equal(glm.readInputShapes.filePath, 1);
});

test("modelScorecardFromOpenCodeRows filters rows by time_created when sinceMs is set", () => {
  const scores = modelScorecardFromOpenCodeRows(
    [
      {
        session_id: "ses_old",
        time_created: Date.parse("2026-04-20T03:00:00.000Z"),
        providerID: "openrouter",
        modelID: "minimax/minimax-m2.5:free",
        tool: "read",
        status: "error",
        error: "Invalid input: expected string, received undefined",
        path: "old.txt",
      },
      {
        session_id: "ses_new",
        time_created: Date.parse("2026-04-20T03:10:00.000Z"),
        providerID: "opencode",
        modelID: "big-pickle",
        tool: "read",
        status: "completed",
        filePath: "new.txt",
      },
    ],
    {
      tool: "read",
      sinceMs: Date.parse("2026-04-20T03:05:00.000Z"),
    },
  );

  assert.equal(scores.length, 1);
  assert.equal(scores[0].model, "opencode/big-pickle");
  assert.equal(scores[0].calls, 1);
  assert.equal(scores[0].completed, 1);
  assert.equal(scores[0].readInputShapes.filePath, 1);
});

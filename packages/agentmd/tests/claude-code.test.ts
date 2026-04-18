import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makeClaudeCodeAgent, makeClaudeCodeJudge } from "../src/claude-code.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(here, "fixtures/fake-claude.mjs");

test("claude-code agent: passes system prompt + stdin, sets safe flags", async () => {
  const agent = makeClaudeCodeAgent({ binary: FAKE, model: "haiku" });
  const raw = await agent("SYSTEM-PROMPT-X", "USER-INPUT-Y");
  const parsed = JSON.parse(raw);

  assert.equal(parsed.bare, false, "should NOT pass --bare (disables OAuth/keychain)");
  assert.equal(parsed.print, true, "should pass -p");
  assert.equal(parsed.noPersist, true, "should pass --no-session-persistence");
  assert.equal(parsed.outputFormat, "text");
  assert.equal(parsed.tools, "", "should pass --tools with empty string to disable tools");
  assert.equal(parsed.model, "haiku");
  assert.equal(parsed.systemPrompt, "SYSTEM-PROMPT-X");
  assert.equal(parsed.userInput, "USER-INPUT-Y");
});

test("claude-code agent: rejects on non-zero exit with stderr", async () => {
  const agent = makeClaudeCodeAgent({ binary: FAKE });
  const prev = process.env.FAKE_CLAUDE_FAIL;
  process.env.FAKE_CLAUDE_FAIL = "1";
  try {
    await assert.rejects(
      () => agent("sys", "user"),
      /simulated failure/,
    );
  } finally {
    if (prev === undefined) delete process.env.FAKE_CLAUDE_FAIL;
    else process.env.FAKE_CLAUDE_FAIL = prev;
  }
});

test("claude-code judge: returns true when output says yes", async () => {
  const prev = process.env.FAKE_CLAUDE_MODE;
  process.env.FAKE_CLAUDE_MODE = "judge";
  try {
    const judge = makeClaudeCodeJudge({ binary: FAKE });
    const yes = await judge("Does this contain the marker?", "text with __FAKE_JUDGE_YES__ inside");
    assert.equal(yes, true);
    const no = await judge("Does this contain the marker?", "text without it");
    assert.equal(no, false);
  } finally {
    if (prev === undefined) delete process.env.FAKE_CLAUDE_MODE;
    else process.env.FAKE_CLAUDE_MODE = prev;
  }
});

test("claude-code agent: omits --model when not provided", async () => {
  const agent = makeClaudeCodeAgent({ binary: FAKE });
  const raw = await agent("sys", "user");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.model, "", "model flag should be absent when not configured");
});

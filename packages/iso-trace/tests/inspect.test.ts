import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSession, inspectSessions } from "../src/inspect.js";
import { parseClaudeCode } from "../src/sources/claude-code.js";
import { parseOpenCode } from "../src/sources/opencode.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLAUDE_FIXTURE = resolve(here, "fixtures/claude-code/sample.jsonl");
const OPENCODE_FIXTURE = resolve(here, "fixtures/opencode/sample.json");

test("inspectSession summarizes messages, tools, previews, and file activity", () => {
  const session = parseClaudeCode(CLAUDE_FIXTURE);
  const inspection = inspectSession(session, { previewChars: 48 });

  assert.equal(inspection.id, session.id);
  assert.equal(inspection.turnCount, 8);
  assert.equal(inspection.messageCount, 4);
  assert.equal(inspection.userMessageCount, 1);
  assert.equal(inspection.assistantMessageCount, 3);
  assert.equal(inspection.toolCallCount, 3);
  assert.equal(inspection.toolResultCount, 3);
  assert.equal(inspection.toolErrorCount, 0);
  assert.equal(inspection.tokenUsageEventCount, 4);
  assert.deepEqual(inspection.toolNames, ["Bash", "Edit", "Read"]);
  assert.deepEqual(inspection.fileOps, {
    read: 1,
    write: 0,
    edit: 1,
    list: 0,
    search: 0,
  });
  assert.deepEqual(inspection.filesTouched.read, ["/tmp/sample-project/README.md"]);
  assert.deepEqual(inspection.filesTouched.edited, ["/tmp/sample-project/README.md"]);
  assert.equal(inspection.preview.firstUser, "read the readme and tell me what this repo does");
  assert.equal(inspection.preview.lastAssistant, "Done. The README is updated to say 'minimal rep…");
});

test("inspectSession carries source metadata like titles and tool errors", () => {
  const session = parseOpenCode(OPENCODE_FIXTURE);
  const inspection = inspectSession(session);

  assert.equal(inspection.title, "Trace demo");
  assert.equal(inspection.toolErrorCount, 0);
  assert.deepEqual(inspection.toolNames, ["glob", "grep", "read"]);
  assert.equal(inspection.preview.firstUser, "Find the TODO and fix it.");
  assert.equal(inspection.preview.lastAssistant, "Error: tool failed");
});

test("inspectSessions maps over multiple sessions", () => {
  const sessions = [parseClaudeCode(CLAUDE_FIXTURE), parseOpenCode(OPENCODE_FIXTURE)];
  const inspections = inspectSessions(sessions);

  assert.equal(inspections.length, 2);
  assert.equal(inspections[0].id, sessions[0].id);
  assert.equal(inspections[1].id, sessions[1].id);
});

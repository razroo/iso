import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";

function withFiles(): { dir: string; policy: string; events: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "iso-guard-cli-"));
  const policy = join(dir, "guard.yaml");
  const events = join(dir, "events.json");
  writeFileSync(policy, [
    "rules:",
    "  - id: no-secret",
    "    type: forbid-text",
    "    patterns: [secret]",
  ].join("\n"));
  writeFileSync(events, JSON.stringify([{ type: "message", text: "plain text" }]));
  return { dir, policy, events, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("main returns success for passing audit", () => {
  const f = withFiles();
  const oldLog = console.log;
  const oldError = console.error;
  const lines: string[] = [];
  console.log = (line?: unknown) => { lines.push(String(line ?? "")); };
  console.error = () => {};
  try {
    const code = main(["audit", f.policy, "--events", f.events]);
    assert.equal(code, 0);
    assert.match(lines.join("\n"), /PASS/);
  } finally {
    console.log = oldLog;
    console.error = oldError;
    f.cleanup();
  }
});

test("main returns usage error for missing --events", () => {
  const f = withFiles();
  const oldError = console.error;
  const lines: string[] = [];
  console.error = (line?: unknown) => { lines.push(String(line ?? "")); };
  try {
    const code = main(["audit", f.policy]);
    assert.equal(code, 2);
    assert.match(lines.join("\n"), /--events is required/);
  } finally {
    console.error = oldError;
    f.cleanup();
  }
});

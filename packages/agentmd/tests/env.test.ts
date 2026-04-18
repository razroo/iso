import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../src/env.js";

function makeEnvDir(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agentmd-env-"));
  writeFileSync(join(dir, ".env"), contents);
  return dir;
}

test("loadDotEnv: parses basic KEY=value lines", () => {
  const dir = makeEnvDir(`TEST_KEY_A=hello\nTEST_KEY_B=world\n`);
  delete process.env.TEST_KEY_A;
  delete process.env.TEST_KEY_B;
  const loaded = loadDotEnv(dir);
  assert.equal(process.env.TEST_KEY_A, "hello");
  assert.equal(process.env.TEST_KEY_B, "world");
  assert.deepEqual(loaded.sort(), ["TEST_KEY_A", "TEST_KEY_B"]);
});

test("loadDotEnv: strips quotes and skips comments", () => {
  const dir = makeEnvDir(`# comment\nTEST_QUOTED="with spaces"\nTEST_APOS='x y'\n\nBAD_LINE_NO_EQUALS\n`);
  delete process.env.TEST_QUOTED;
  delete process.env.TEST_APOS;
  loadDotEnv(dir);
  assert.equal(process.env.TEST_QUOTED, "with spaces");
  assert.equal(process.env.TEST_APOS, "x y");
});

test("loadDotEnv: does not overwrite existing env vars", () => {
  const dir = makeEnvDir(`TEST_PRE_SET=from-dotenv\n`);
  process.env.TEST_PRE_SET = "from-shell";
  const loaded = loadDotEnv(dir);
  assert.equal(process.env.TEST_PRE_SET, "from-shell");
  assert.ok(!loaded.includes("TEST_PRE_SET"));
});

test("loadDotEnv: no .env present is a no-op", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentmd-env-none-"));
  const loaded = loadDotEnv(dir);
  assert.deepEqual(loaded, []);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPolicy, parsePolicyText } from "../src/policy.js";

function writePolicy(body: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "iso-guard-policy-"));
  const path = join(dir, "guard.yaml");
  writeFileSync(path, body);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("parses a policy with all initial rule types", () => {
  const policy = parsePolicyText([
    "version: 1",
    "rules:",
    "  - id: max-two",
    "    type: max-per-group",
    "    match: { type: tool_call, name: task }",
    "    groupBy: round",
    "    max: 2",
    "  - id: cleanup",
    "    type: require-before",
    "    trigger: { type: tool_call, name: task }",
    "    require: { type: tool_call, name: geometra_disconnect }",
    "  - id: follow-up",
    "    type: require-after",
    "    ifAny: { type: tool_call, name: task }",
    "    require:",
    "      - { type: tool_call, name: merge }",
    "  - id: secret",
    "    type: forbid-text",
    "    patterns:",
    "      - password",
    "  - id: overlap",
    "    type: no-overlap",
    "    start: { type: task_start }",
    "    end: { type: task_end }",
    "    keyBy: companyRole",
  ].join("\n"));

  assert.equal(policy.version, 1);
  assert.equal(policy.rules.length, 5);
});

test("rejects invalid rule type", () => {
  assert.throws(
    () => parsePolicyText(["rules:", "  - id: bad", "    type: maybe"].join("\n")),
    /type must be one of/,
  );
});

test("rejects duplicate rule ids", () => {
  assert.throws(
    () => parsePolicyText([
      "rules:",
      "  - id: duplicate",
      "    type: forbid-text",
      "    patterns: [secret]",
      "  - id: duplicate",
      "    type: forbid-text",
      "    patterns: [secret]",
    ].join("\n")),
    /duplicate rule id/,
  );
});

test("loadPolicy reads from disk", () => {
  const s = writePolicy(["rules:", "  - id: one", "    type: forbid-text", "    patterns: [secret]"].join("\n"));
  try {
    const policy = loadPolicy(s.path);
    assert.equal(policy.sourcePath, s.path);
    assert.equal(policy.rules[0]?.id, "one");
  } finally {
    s.cleanup();
  }
});

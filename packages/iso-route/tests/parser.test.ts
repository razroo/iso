import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "../src/parser.js";

function writePolicy(body: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "iso-route-parser-"));
  const p = join(dir, "models.yaml");
  writeFileSync(p, body);
  return { path: p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("rejects file without default block", () => {
  const s = writePolicy("roles: {}\n");
  try {
    assert.throws(() => loadPolicy(s.path), /"default"/);
  } finally {
    s.cleanup();
  }
});

test("rejects unknown provider", () => {
  const s = writePolicy(["default:", "  provider: megacorp", "  model: x"].join("\n"));
  try {
    assert.throws(() => loadPolicy(s.path), /provider must be one of/);
  } finally {
    s.cleanup();
  }
});

test("rejects empty model string", () => {
  const s = writePolicy(
    ["default:", "  provider: anthropic", '  model: ""'].join("\n"),
  );
  try {
    assert.throws(() => loadPolicy(s.path), /model \(non-empty string\) is required/);
  } finally {
    s.cleanup();
  }
});

test("rejects unknown reasoning value", () => {
  const s = writePolicy(
    [
      "default:",
      "  provider: anthropic",
      "  model: claude-sonnet-4-6",
      "  reasoning: extreme",
    ].join("\n"),
  );
  try {
    assert.throws(() => loadPolicy(s.path), /reasoning must be one of/);
  } finally {
    s.cleanup();
  }
});

test("rejects invalid role name", () => {
  const s = writePolicy(
    [
      "default:",
      "  provider: anthropic",
      "  model: claude-sonnet-4-6",
      "roles:",
      "  Bad_Name:",
      "    provider: anthropic",
      "    model: claude-haiku-4-5",
    ].join("\n"),
  );
  try {
    assert.throws(() => loadPolicy(s.path), /role name "Bad_Name" is invalid/);
  } finally {
    s.cleanup();
  }
});

test("parses full policy with roles, reasoning, and fallback chain", () => {
  const s = writePolicy(
    [
      "default:",
      "  provider: anthropic",
      "  model: claude-sonnet-4-6",
      "roles:",
      "  planner:",
      "    provider: anthropic",
      "    model: claude-opus-4-7",
      "    reasoning: high",
      "  reviewer:",
      "    provider: openai",
      "    model: gpt-5",
      "    fallback:",
      "      - { provider: anthropic, model: claude-sonnet-4-6 }",
    ].join("\n"),
  );
  try {
    const p = loadPolicy(s.path);
    assert.equal(p.default.provider, "anthropic");
    assert.equal(p.default.model, "claude-sonnet-4-6");
    assert.equal(p.roles.length, 2);

    const planner = p.roles.find((r) => r.name === "planner");
    assert.ok(planner);
    assert.equal(planner.reasoning, "high");

    const reviewer = p.roles.find((r) => r.name === "reviewer");
    assert.ok(reviewer);
    assert.equal(reviewer.fallback?.length, 1);
    assert.equal(reviewer.fallback?.[0]?.provider, "anthropic");
  } finally {
    s.cleanup();
  }
});

test("policy without roles block still parses — roles defaults to empty array", () => {
  const s = writePolicy(
    ["default:", "  provider: anthropic", "  model: claude-sonnet-4-6"].join("\n"),
  );
  try {
    const p = loadPolicy(s.path);
    assert.equal(p.roles.length, 0);
  } finally {
    s.cleanup();
  }
});

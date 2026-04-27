import { test } from "node:test";
import assert from "node:assert/strict";
import { emitClaude } from "../src/targets/claude.js";
import { emitCodex } from "../src/targets/codex.js";
import { emitCursor } from "../src/targets/cursor.js";
import { emitOpenCode } from "../src/targets/opencode.js";
import { emitPi } from "../src/targets/pi.js";
import type { ModelPolicy } from "../src/types.js";

function policy(): ModelPolicy {
  return {
    default: { provider: "anthropic", model: "claude-sonnet-4-6" },
    roles: [
      { name: "planner", provider: "anthropic", model: "claude-opus-4-7", reasoning: "high" },
      {
        name: "reviewer",
        provider: "openai",
        model: "gpt-5",
        fallback: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
      },
    ],
    sourcePath: "/tmp/models.yaml",
    sourceDir: "/tmp",
  };
}

test("claude: writes settings.json with default model", () => {
  const out = emitClaude(policy());
  const settings = out.files.find((f) => f.path === ".claude/settings.json");
  assert.ok(settings);
  assert.deepEqual(JSON.parse(settings.contents), { model: "claude-sonnet-4-6" });
});

test("claude: emits resolved role map for iso-harness to consume", () => {
  const out = emitClaude(policy());
  const resolved = out.files.find((f) => f.path === ".claude/iso-route.resolved.json");
  assert.ok(resolved);
  const parsed = JSON.parse(resolved.contents);
  assert.equal(parsed.roles.planner.model, "claude-opus-4-7");
  assert.equal(parsed.roles.reviewer.fallback[0].provider, "anthropic");
});

test("claude: warns on non-anthropic role and on fallback chains", () => {
  const out = emitClaude(policy());
  assert.ok(
    out.warnings.some((w) => w.includes('role "reviewer"') && w.includes('provider "openai"')),
    `expected non-anthropic role warning, got: ${JSON.stringify(out.warnings)}`,
  );
  assert.ok(
    out.warnings.some((w) => w.includes("fallback chain")),
    `expected fallback warning, got: ${JSON.stringify(out.warnings)}`,
  );
});

test("codex: writes config.toml with default model + a profile per role", () => {
  const out = emitCodex(policy());
  const config = out.files.find((f) => f.path === ".codex/config.toml");
  assert.ok(config);
  const s = config.contents;
  assert.match(s, /^model = "claude-sonnet-4-6"$/m);
  assert.match(s, /\[profiles\.planner\]/);
  assert.match(s, /model_reasoning_effort = "high"/);
  assert.match(s, /\[profiles\.reviewer\]/);
  assert.match(s, /\[model_providers\.anthropic\]/);
  assert.match(s, /\[profiles\.reviewer\][\s\S]*model_provider = "openai"/);
  assert.doesNotMatch(s, /\[model_providers\.openai\]/);
});

test("opencode: writes opencode.json with provider-qualified model and per-agent overrides", () => {
  const out = emitOpenCode(policy());
  const config = out.files.find((f) => f.path === "opencode.json");
  assert.ok(config);
  const parsed = JSON.parse(config.contents) as {
    model: string;
    agent: Record<string, { model: string }>;
    provider: Record<string, { npm: string }>;
  };
  assert.equal(parsed.model, "anthropic/claude-sonnet-4-6");
  assert.equal(parsed.agent.planner.model, "anthropic/claude-opus-4-7");
  assert.equal(parsed.agent.reviewer.model, "openai/gpt-5");
  assert.ok(parsed.provider.anthropic);
  assert.ok(parsed.provider.openai);
});

test("cursor: emits a README-only note and flags that binding is manual", () => {
  const out = emitCursor(policy());
  const note = out.files.find((f) => f.path === ".cursor/iso-route.md");
  assert.ok(note);
  assert.match(note.contents, /anthropic \/ claude-sonnet-4-6/);
  assert.match(note.contents, /planner/);
  assert.ok(
    out.warnings.some((w) => w.includes("no programmatic model binding")),
    `expected cursor limitation warning, got: ${JSON.stringify(out.warnings)}`,
  );
});

test("pi: writes settings.json with default model and role model cycling", () => {
  const out = emitPi(policy());
  const settings = out.files.find((f) => f.path === ".pi/settings.json");
  assert.ok(settings);
  const parsed = JSON.parse(settings.contents) as {
    defaultProvider: string;
    defaultModel: string;
    defaultThinkingLevel?: string;
    enabledModels: string[];
  };
  assert.equal(parsed.defaultProvider, "anthropic");
  assert.equal(parsed.defaultModel, "claude-sonnet-4-6");
  assert.deepEqual(parsed.enabledModels, ["claude-sonnet-4-6", "claude-opus-4-7", "gpt-5"]);

  const note = out.files.find((f) => f.path === ".pi/iso-route.md");
  assert.ok(note);
  assert.match(note.contents, /planner/);
  assert.match(note.contents, /gpt-5/);
  assert.ok(
    out.warnings.some((w) => w.includes("no native role/subagent model binding")),
    `expected pi role-binding warning, got: ${JSON.stringify(out.warnings)}`,
  );
});

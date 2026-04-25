/**
 * `extends: <preset>` loads a bundled preset as the base layer, then
 * deep-merges the user's fields on top. User wins at every key. `targets`
 * sub-objects merge atomically per harness — a user override replaces the
 * preset's override for that harness as a unit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPresets, loadPolicy } from "../src/parser.js";

function writeYaml(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "iso-route-extends-"));
  const p = join(dir, "models.yaml");
  writeFileSync(p, contents);
  return p;
}

test("listPresets: returns the built-in preset names", () => {
  const presets = listPresets();
  assert.ok(presets.includes("standard"), `expected "standard" in ${JSON.stringify(presets)}`);
  assert.ok(presets.includes("budget"), `expected "budget" in ${JSON.stringify(presets)}`);
  assert.ok(
    presets.includes("openrouter-free"),
    `expected "openrouter-free" in ${JSON.stringify(presets)}`,
  );
});

test("extends budget: default pushed to haiku, quality lowered to sonnet", () => {
  const path = writeYaml("extends: budget\n");
  const policy = loadPolicy(path);
  // Budget's thesis: everything is one tier cheaper than standard.
  assert.equal(policy.default.model, "claude-haiku-4-5");
  const quality = policy.roles.find((r) => r.name === "quality");
  assert.ok(quality, "budget preset must include a quality role");
  assert.equal(quality.model, "claude-sonnet-4-6");
  const fast = policy.roles.find((r) => r.name === "fast");
  assert.ok(fast);
  assert.equal(fast.model, "claude-haiku-4-5");
});

test("extends budget: user can upgrade just the quality.targets.claude pick back to opus", () => {
  const path = writeYaml(
    [
      "extends: budget",
      "roles:",
      "  quality:",
      "    targets:",
      "      claude:",
      "        provider: anthropic",
      "        model: claude-opus-4-7",
      "",
    ].join("\n"),
  );
  const policy = loadPolicy(path);
  const quality = policy.roles.find((r) => r.name === "quality");
  assert.ok(quality);
  // Sonnet stays at the top-level (falling through on codex/opencode), but
  // claude target is now opus again.
  assert.equal(quality.model, "claude-sonnet-4-6");
  assert.equal(quality.targets?.claude?.model, "claude-opus-4-7");
});

test("extends standard: user gets preset default + roles unchanged", () => {
  const path = writeYaml("extends: standard\n");
  const policy = loadPolicy(path);
  assert.equal(policy.default.provider, "anthropic");
  assert.equal(policy.default.model, "claude-sonnet-4-6");
  const roleNames = policy.roles.map((r) => r.name).sort();
  assert.deepEqual(roleNames, ["fast", "minimal", "quality"]);
  assert.equal(policy.default.targets?.opencode?.model, "opencode-go/deepseek-v4-flash");
  const fast = policy.roles.find((r) => r.name === "fast")!;
  assert.equal(fast.provider, "anthropic");
  assert.equal(fast.model, "claude-haiku-4-5");
  assert.equal(fast.targets?.opencode?.model, "opencode/big-pickle");
  const quality = policy.roles.find((r) => r.name === "quality")!;
  assert.equal(quality.targets?.opencode?.model, "opencode-go/deepseek-v4-pro");
});

test("extends openrouter-free: OpenCode targets use explicit free OpenRouter model IDs", () => {
  const path = writeYaml("extends: openrouter-free\n");
  const policy = loadPolicy(path);
  assert.equal(policy.default.provider, "anthropic");
  assert.equal(policy.default.targets?.opencode?.provider, "openrouter");
  assert.equal(policy.default.targets?.opencode?.model, "qwen/qwen3-coder:free");
  const quality = policy.roles.find((r) => r.name === "quality")!;
  assert.equal(quality.targets?.opencode?.provider, "openrouter");
  assert.equal(quality.targets?.opencode?.model, "qwen/qwen3-next-80b-a3b-instruct:free");
  const fast = policy.roles.find((r) => r.name === "fast")!;
  assert.equal(fast.targets?.opencode?.model, "z-ai/glm-4.5-air:free");
  const minimal = policy.roles.find((r) => r.name === "minimal")!;
  assert.equal(minimal.targets?.opencode?.model, "openai/gpt-oss-20b:free");
});

test("extends standard: scalar override on default replaces just that scalar", () => {
  const path = writeYaml(`extends: standard
default:
  model: claude-opus-4-7
`);
  const policy = loadPolicy(path);
  assert.equal(policy.default.provider, "anthropic", "provider preserved from preset");
  assert.equal(policy.default.model, "claude-opus-4-7", "model overridden");
  // targets.opencode still from preset
  assert.equal(policy.default.targets?.opencode?.model, "opencode-go/deepseek-v4-flash");
});

test("extends standard: target override on a role replaces that target atomically", () => {
  const path = writeYaml(`extends: standard
roles:
  fast:
    targets:
      codex:
        provider: anthropic
        model: claude-haiku-4-5
`);
  const policy = loadPolicy(path);
  const fast = policy.roles.find((r) => r.name === "fast")!;
  // opencode target preserved from preset
  assert.equal(fast.targets?.opencode?.provider, "opencode");
  assert.equal(fast.targets?.opencode?.model, "opencode/big-pickle");
  // codex target replaced (preset had openai/gpt-5.4-mini)
  assert.equal(fast.targets?.codex?.provider, "anthropic");
  assert.equal(fast.targets?.codex?.model, "claude-haiku-4-5");
});

test("extends standard: user can add a brand-new role alongside preset roles", () => {
  const path = writeYaml(`extends: standard
roles:
  custom:
    provider: anthropic
    model: claude-haiku-4-5
`);
  const policy = loadPolicy(path);
  const names = policy.roles.map((r) => r.name).sort();
  assert.deepEqual(names, ["custom", "fast", "minimal", "quality"]);
});

test("extends standard: explicit null target removes the preset's override", () => {
  const path = writeYaml(`extends: standard
roles:
  fast:
    targets:
      codex: null
`);
  const policy = loadPolicy(path);
  const fast = policy.roles.find((r) => r.name === "fast")!;
  assert.equal(fast.targets?.codex, undefined, "codex override was removed");
  assert.ok(fast.targets?.opencode, "opencode override still present");
});

test("extends: unknown preset name is rejected with the available list", () => {
  const path = writeYaml("extends: nonexistent\n");
  assert.throws(() => loadPolicy(path), /preset "nonexistent" not found|Available|Built-in presets/);
});

test("extends: empty string is rejected", () => {
  const path = writeYaml(`extends: ""\n`);
  assert.throws(() => loadPolicy(path), /extends.*must be.*name|extends.*preset/);
});

test("extends: preset alone (no user additions) still parses + has default + roles", () => {
  const path = writeYaml("extends: standard\n");
  const policy = loadPolicy(path);
  assert.ok(policy.default);
  assert.ok(policy.roles.length > 0);
});

test("extends: user-replaced default scalar flows into each target emit", () => {
  // Regression: earlier implementation deep-merged targets at the field
  // level, so a user's override lost the provider because the preset's
  // provider bled through. This test makes sure a fully-specified target
  // from the user is atomic.
  const path = writeYaml(`extends: standard
default:
  targets:
    opencode:
      provider: anthropic
      model: anthropic/claude-sonnet-4-6
`);
  const policy = loadPolicy(path);
  assert.equal(policy.default.targets?.opencode?.provider, "anthropic");
  assert.equal(policy.default.targets?.opencode?.model, "anthropic/claude-sonnet-4-6");
});

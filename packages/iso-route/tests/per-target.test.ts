/**
 * Per-target model overrides.
 *
 * `default.targets.<harness>` and `roles.<name>.targets.<harness>` let a
 * single models.yaml express different model picks on each harness
 * (Haiku on Claude Code, opencode/big-pickle on OpenCode, gpt-5-mini on
 * Codex, etc.). The build pipeline calls `resolvePolicyForTarget` before
 * each emit, so emitters themselves see a flat ProviderModel without the
 * `targets` field.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "../src/parser.js";
import { resolvePolicyForTarget } from "../src/build.js";
import { emitClaude } from "../src/targets/claude.js";
import { emitCodex } from "../src/targets/codex.js";
import { emitCursor } from "../src/targets/cursor.js";
import { emitOpenCode } from "../src/targets/opencode.js";

function writeModelsYaml(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "iso-route-per-target-"));
  const p = join(dir, "models.yaml");
  writeFileSync(p, contents);
  return p;
}

const POLICY_WITH_TARGETS = `
default:
  provider: anthropic
  model: claude-sonnet-4-6
  targets:
    opencode:
      provider: opencode
      model: opencode/glm-5.1

roles:
  general-free:
    provider: anthropic
    model: claude-haiku-4-5
    targets:
      opencode:
        provider: opencode
        model: opencode/big-pickle
      codex:
        provider: openai
        model: gpt-5-mini
  general-paid:
    provider: anthropic
    model: claude-sonnet-4-6
`;

test("parser: accepts targets.<harness> on default and on roles", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  assert.equal(policy.default.targets?.opencode?.model, "opencode/glm-5.1");
  const free = policy.roles.find((r) => r.name === "general-free")!;
  assert.equal(free.targets?.opencode?.model, "opencode/big-pickle");
  assert.equal(free.targets?.codex?.model, "gpt-5-mini");
  assert.equal(free.targets?.codex?.provider, "openai");
});

test("parser: rejects unknown harness names under targets", () => {
  const path = writeModelsYaml(`
default:
  provider: anthropic
  model: claude-sonnet-4-6
roles:
  x:
    provider: anthropic
    model: claude-haiku-4-5
    targets:
      windsurf:
        provider: anthropic
        model: claude-haiku-4-5
`);
  assert.throws(() => loadPolicy(path), /unknown harness/);
});

test("resolvePolicyForTarget: applies opencode override on roles", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  const resolved = resolvePolicyForTarget(policy, "opencode");
  const free = resolved.roles.find((r) => r.name === "general-free")!;
  assert.equal(free.provider, "opencode");
  assert.equal(free.model, "opencode/big-pickle");
  // The `.targets` field must NOT be on the resolved policy — emitters
  // should only see flat ProviderModels.
  assert.equal((free as { targets?: unknown }).targets, undefined);
  assert.equal((resolved.default as { targets?: unknown }).targets, undefined);
});

test("resolvePolicyForTarget: falls through when no target override", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  const resolved = resolvePolicyForTarget(policy, "claude");
  const free = resolved.roles.find((r) => r.name === "general-free")!;
  assert.equal(free.provider, "anthropic");
  assert.equal(free.model, "claude-haiku-4-5");
  const paid = resolved.roles.find((r) => r.name === "general-paid")!;
  assert.equal(paid.model, "claude-sonnet-4-6");
});

test("end-to-end: opencode target emits per-target models", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  const out = emitOpenCode(resolvePolicyForTarget(policy, "opencode"));
  const cfg = JSON.parse(out.files[0].contents);
  // Top-level default uses the opencode override
  assert.equal(cfg.model, "opencode/glm-5.1");
  // Per-agent aliases — general-free uses opencode override, general-paid
  // falls through to the generic (anthropic) policy
  assert.equal(cfg.agent["general-free"].model, "opencode/big-pickle");
  assert.equal(cfg.agent["general-paid"].model, "anthropic/claude-sonnet-4-6");
  // `opencode` provider must not emit an npm package entry — the proxy is
  // native to OpenCode and has no SDK to install.
  assert.equal(cfg.provider?.opencode, undefined);
  // `anthropic` provider IS emitted (general-paid still routes there)
  assert.ok(cfg.provider?.anthropic);
});

test("end-to-end: codex target applies openai override on the role", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  const out = emitCodex(resolvePolicyForTarget(policy, "codex"));
  const toml = out.files[0].contents;
  // default stays anthropic (no codex-target override on default)
  assert.match(toml, /^model = "claude-sonnet-4-6"$/m);
  // general-free role is overridden to gpt-5-mini on codex
  assert.match(toml, /\[profiles\.general-free\]\nmodel = "gpt-5-mini"\nmodel_provider = "openai"/);
});

test("end-to-end: claude target ignores opencode-only overrides", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  const out = emitClaude(resolvePolicyForTarget(policy, "claude"));
  const resolved = JSON.parse(
    out.files.find((f) => f.path === ".claude/iso-route.resolved.json")!.contents,
  );
  // general-free used an OpenCode override but nothing claude-specific;
  // claude should see the generic anthropic/claude-haiku-4-5.
  assert.equal(resolved.roles["general-free"].provider, "anthropic");
  assert.equal(resolved.roles["general-free"].model, "claude-haiku-4-5");
});

test("end-to-end: cursor README reflects resolved per-target choices", () => {
  const path = writeModelsYaml(POLICY_WITH_TARGETS);
  const policy = loadPolicy(path);
  const out = emitCursor(resolvePolicyForTarget(policy, "cursor"));
  const contents = out.files[0].contents;
  // No cursor-specific override anywhere, so cursor's README shows the
  // generic anthropic picks.
  assert.match(contents, /anthropic \/ claude-sonnet-4-6/);
  assert.match(contents, /general-free.*claude-haiku-4-5/);
});

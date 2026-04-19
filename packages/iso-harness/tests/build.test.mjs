import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.mjs';
import { loadSource } from '../src/source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, '..');
const MINIMAL_ISO = resolve(PACKAGE, 'examples/minimal/iso');

function mkIso(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'iso-harness-build-'));
  const iso = join(dir, 'iso');
  mkdirSync(join(iso, 'agents'), { recursive: true });
  mkdirSync(join(iso, 'commands'), { recursive: true });
  writeFileSync(
    join(iso, 'mcp.json'),
    overrides.mcp ?? JSON.stringify({ servers: { a: { command: 'echo' } } }, null, 2),
  );
  writeFileSync(
    join(iso, 'instructions.md'),
    overrides.instructions ?? '# Project\n\nGuidelines.\n',
  );
  writeFileSync(
    join(iso, 'agents', 'a.md'),
    overrides.agent ??
      '---\nname: a\ndescription: sample agent\n---\n\nAgent body here.\n',
  );
  writeFileSync(
    join(iso, 'commands', 'go.md'),
    overrides.command ??
      '---\nname: go\ndescription: do the thing\n---\n\nCommand body.\n',
  );
  return { dir, iso, out: join(dir, 'out') };
}

test('build: existing minimal example still produces all 11 files', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'iso-harness-smoke-'));
  const summary = await build({
    source: MINIMAL_ISO,
    out: outDir,
    targets: ['claude', 'cursor', 'codex', 'opencode'],
  });
  const expected = [
    'CLAUDE.md',
    '.claude/agents/researcher.md',
    '.claude/commands/review.md',
    '.mcp.json',
    '.cursor/rules/main.mdc',
    '.cursor/mcp.json',
    'AGENTS.md',
    '.codex/config.toml',
    'opencode.json',
    '.opencode/agents/researcher.md',
    '.opencode/skills/review.md',
  ];
  for (const f of expected) {
    assert.ok(existsSync(join(outDir, f)), `missing: ${f}`);
  }
  assert.match(summary[0], /loaded 1 agent\(s\), 1 command\(s\), 1 MCP server/);
});

test('build: refuses to write output when the source has schema errors', async () => {
  const { iso, out } = mkIso({
    mcp: JSON.stringify({ servers: { bad: { args: ['no-command'] } } }),
  });
  await assert.rejects(
    () => build({ source: iso, out, targets: ['claude'] }),
    /source validation failed/,
  );
  assert.ok(
    !existsSync(out) || !existsSync(join(out, 'CLAUDE.md')),
    'CLAUDE.md must not exist when validation fails',
  );
});

test('build: warnings are surfaced but do not block the write', async () => {
  const { iso, out } = mkIso({
    agent: '---\nname: a\n---\n\nBody.\n',
  });
  const summary = await build({ source: iso, out, targets: ['claude'] });
  assert.ok(summary.some((line) => /warning.*description/.test(line)));
  assert.ok(existsSync(join(out, '.claude/agents/a.md')));
});

test('build: target=skip in agent frontmatter omits the file for that target only', async () => {
  const { iso, out } = mkIso({
    agent:
      '---\nname: a\ndescription: sample agent\ntargets:\n  claude: skip\n---\n\nAgent body.\n',
  });
  await build({ source: iso, out, targets: ['claude', 'opencode'] });
  assert.ok(!existsSync(join(out, '.claude/agents/a.md')));
  assert.ok(existsSync(join(out, '.opencode/agents/a.md')));
});

test('loadSource: ignores markdown files starting with "_"', async () => {
  const { iso } = mkIso();
  writeFileSync(
    join(iso, 'agents', '_shared.md'),
    '---\nname: _shared\n---\n\nShould be ignored.\n',
  );
  const src = await loadSource(iso);
  assert.equal(src.agents.length, 1);
  assert.equal(src.agents[0].slug, 'a');
});

test('loadSource: throws a clear error when mcp.json is not valid JSON', async () => {
  const { iso } = mkIso({ mcp: '{broken json,' });
  await assert.rejects(() => loadSource(iso), /Invalid iso\/mcp\.json/);
});

test('loadSource: throws a clear error when mcp.json has no servers object', async () => {
  const { iso } = mkIso({ mcp: '{"wrong":{}}' });
  await assert.rejects(() => loadSource(iso), /top-level "servers" object/);
});

test('build: rendered CLAUDE.md preserves the instructions file verbatim (plus trailing newline)', async () => {
  const { iso, out } = mkIso({ instructions: '# My project\n\nRule 1.\nRule 2.' });
  await build({ source: iso, out, targets: ['claude'] });
  const got = readFileSync(join(out, 'CLAUDE.md'), 'utf8');
  assert.equal(got, '# My project\n\nRule 1.\nRule 2.\n');
});

test('build: --dry-run returns a summary without writing any files', async () => {
  const { iso, out } = mkIso();
  const summary = await build({ source: iso, out, targets: ['claude'], dryRun: true });
  assert.ok(!existsSync(out), 'output dir must not be created in dry-run');
  assert.match(summary[0], /dry-run/);
  assert.ok(summary.some((line) => /would write/.test(line)));
  assert.ok(summary.some((line) => /no files written/.test(line)));
});

test('build: --dry-run still errors on schema violations (no silent pass)', async () => {
  const { iso, out } = mkIso({
    mcp: JSON.stringify({ servers: { bad: { args: ['no-command'] } } }),
  });
  await assert.rejects(
    () => build({ source: iso, out, targets: ['claude'], dryRun: true }),
    /source validation failed/,
  );
});

test('build: codex TOML escapes double quotes in command/args', async () => {
  const { iso, out } = mkIso({
    mcp: JSON.stringify({
      servers: { quoted: { command: 'echo', args: ['he said "hi"'] } },
    }),
  });
  await build({ source: iso, out, targets: ['codex'] });
  const toml = readFileSync(join(out, '.codex/config.toml'), 'utf8');
  assert.match(toml, /args = \["he said \\"hi\\""\]/);
});

test('build: codex config.toml merges with existing iso-route content', async () => {
  const { iso, out } = mkIso();
  // Simulate `@razroo/iso-route build` having already written model + profile
  // blocks to config.toml. iso-harness must preserve everything except
  // the `[mcp_servers.*]` sections.
  mkdirSync(join(out, '.codex'), { recursive: true });
  writeFileSync(
    join(out, '.codex/config.toml'),
    [
      '# generated by @razroo/iso-route — do not hand-edit',
      'model = "claude-sonnet-4-6"',
      'model_provider = "anthropic"',
      '',
      '[profiles.planner]',
      'model = "claude-opus-4-7"',
      'model_provider = "anthropic"',
      'model_reasoning_effort = "high"',
      '',
      '[model_providers.anthropic]',
      'name = "Anthropic"',
      'base_url = "https://api.anthropic.com/v1"',
      'env_key = "ANTHROPIC_API_KEY"',
      '',
      '[mcp_servers.stale-from-prior-run]',
      'command = "echo"',
      '',
    ].join('\n'),
  );
  await build({ source: iso, out, targets: ['codex'] });
  const toml = readFileSync(join(out, '.codex/config.toml'), 'utf8');
  // Preserved: model policy, profiles, provider blocks
  assert.match(toml, /model = "claude-sonnet-4-6"/);
  assert.match(toml, /\[profiles\.planner\]/);
  assert.match(toml, /\[model_providers\.anthropic\]/);
  // Replaced: the stale prior mcp_servers block is gone
  assert.doesNotMatch(toml, /stale-from-prior-run/);
  // Added: the fresh MCP section from the current iso source
  assert.match(toml, /\[mcp_servers\.a\]/);
  assert.match(toml, /command = "echo"/);
});

test('build: codex config.toml handles no pre-existing file', async () => {
  const { iso, out } = mkIso();
  await build({ source: iso, out, targets: ['codex'] });
  const toml = readFileSync(join(out, '.codex/config.toml'), 'utf8');
  // Only the MCP section, nothing else.
  assert.match(toml, /\[mcp_servers\.a\]/);
  assert.doesNotMatch(toml, /\[profiles\./);
});

test('build: opencode agent stamps model from iso-route config when no inline model', async () => {
  const { iso, out } = mkIso({
    agent:
      '---\nname: a\ndescription: sample\ntargets:\n  opencode:\n    mode: subagent\n---\n\nBody.\n',
  });
  // Simulate iso-route having pre-written opencode.json with an agent map.
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model: 'anthropic/claude-sonnet-4-6',
        agent: {
          a: { model: 'opencode/big-pickle' },
        },
      },
      null,
      2,
    ),
  );
  await build({ source: iso, out, targets: ['opencode'] });
  const agentBody = readFileSync(join(out, '.opencode/agents/a.md'), 'utf8');
  // Model from the resolved map was stamped onto the agent file.
  assert.match(agentBody, /^model: opencode\/big-pickle$/m);
});

test('build: inline opencode model still wins over iso-route resolved map', async () => {
  const { iso, out } = mkIso({
    agent:
      '---\nname: a\ndescription: sample\ntargets:\n  opencode:\n    mode: subagent\n    model: inline/pinned-model\n---\n\nBody.\n',
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        agent: { a: { model: 'should/not/win' } },
      },
      null,
      2,
    ),
  );
  await build({ source: iso, out, targets: ['opencode'] });
  const agentBody = readFileSync(join(out, '.opencode/agents/a.md'), 'utf8');
  assert.match(agentBody, /^model: inline\/pinned-model$/m);
  assert.doesNotMatch(agentBody, /should\/not\/win/);
});

test('build: opencode.json merges with existing iso-route model config', async () => {
  const { iso, out } = mkIso();
  // Simulate `@razroo/iso-route build` having already written model routing
  // fields to opencode.json. iso-harness must preserve them and layer only
  // its own $schema + mcp on top.
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model: 'anthropic/claude-sonnet-4-6',
        agent: {
          planner: { model: 'anthropic/claude-opus-4-7' },
          'fast-edit': { model: 'anthropic/claude-haiku-4-5' },
        },
      },
      null,
      2,
    ),
  );
  await build({ source: iso, out, targets: ['opencode'] });
  const cfg = JSON.parse(readFileSync(join(out, 'opencode.json'), 'utf8'));
  // Preserved: iso-route's model + agent fields
  assert.equal(cfg.model, 'anthropic/claude-sonnet-4-6');
  assert.equal(cfg.agent?.planner?.model, 'anthropic/claude-opus-4-7');
  assert.equal(cfg.agent?.['fast-edit']?.model, 'anthropic/claude-haiku-4-5');
  // Added/overwritten by iso-harness: $schema + mcp
  assert.equal(cfg.$schema, 'https://opencode.ai/config.json');
  assert.ok(cfg.mcp?.a, 'expected mcp.a to be present');
});

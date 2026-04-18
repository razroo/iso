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

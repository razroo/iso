import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../src/build.mjs';
import { parse as parseFrontmatter } from '../src/frontmatter.mjs';

function mkIso(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'iso-harness-isoroute-'));
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
    join(iso, 'agents', 'planner.md'),
    overrides.agent ??
      '---\nname: planner\ndescription: plans the work\n---\n\nAgent body.\n',
  );
  writeFileSync(
    join(iso, 'commands', 'go.md'),
    '---\nname: go\ndescription: do the thing\n---\n\nCommand body.\n',
  );
  return { dir, iso, out: join(dir, 'out') };
}

function writeResolvedMap(outDir, roles) {
  mkdirSync(join(outDir, '.claude'), { recursive: true });
  writeFileSync(
    join(outDir, '.claude', 'iso-route.resolved.json'),
    JSON.stringify(
      {
        default: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        roles,
      },
      null,
      2,
    ) + '\n',
  );
}

function readAgentFrontmatter(outDir, slug) {
  const raw = readFileSync(join(outDir, '.claude', 'agents', `${slug}.md`), 'utf8');
  return parseFrontmatter(raw).data;
}

test('iso-route: stamps model from resolved map when role matches agent slug', async () => {
  const { iso, out } = mkIso();
  writeResolvedMap(out, {
    planner: { provider: 'anthropic', model: 'claude-opus-4-7', reasoning: 'high' },
  });
  await build({ source: iso, out, targets: ['claude'] });
  const fm = readAgentFrontmatter(out, 'planner');
  assert.equal(fm.model, 'claude-opus-4-7');
});

test('iso-route: inline model frontmatter takes precedence over the resolved map', async () => {
  const { iso, out } = mkIso({
    agent:
      '---\nname: planner\ndescription: plans the work\nmodel: claude-haiku-4-5\n---\n\nBody.\n',
  });
  writeResolvedMap(out, {
    planner: { provider: 'anthropic', model: 'claude-opus-4-7' },
  });
  await build({ source: iso, out, targets: ['claude'] });
  const fm = readAgentFrontmatter(out, 'planner');
  assert.equal(fm.model, 'claude-haiku-4-5');
});

test('iso-route: explicit role: frontmatter overrides slug-based lookup', async () => {
  const { iso, out } = mkIso({
    agent:
      '---\nname: planner\ndescription: plans\nrole: reviewer\n---\n\nBody.\n',
  });
  writeResolvedMap(out, {
    planner: { provider: 'anthropic', model: 'claude-opus-4-7' },
    reviewer: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  });
  await build({ source: iso, out, targets: ['claude'] });
  const fm = readAgentFrontmatter(out, 'planner');
  assert.equal(fm.model, 'claude-sonnet-4-6');
});

test('iso-route: non-anthropic role emits without model and logs a warning', async () => {
  const { iso, out } = mkIso();
  writeResolvedMap(out, {
    planner: { provider: 'openai', model: 'gpt-5' },
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    await build({ source: iso, out, targets: ['claude'] });
  } finally {
    console.warn = originalWarn;
  }
  const fm = readAgentFrontmatter(out, 'planner');
  assert.equal(fm.model, undefined, 'model must be omitted for non-anthropic roles');
  assert.ok(
    warnings.some((w) => w.includes('planner') && w.includes('openai')),
    `expected a warning mentioning planner + openai, got: ${JSON.stringify(warnings)}`,
  );
});

test('iso-route: role absent from map silently leaves the agent without a model', async () => {
  const { iso, out } = mkIso();
  writeResolvedMap(out, {
    reviewer: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    await build({ source: iso, out, targets: ['claude'] });
  } finally {
    console.warn = originalWarn;
  }
  const fm = readAgentFrontmatter(out, 'planner');
  assert.equal(fm.model, undefined);
  assert.equal(warnings.length, 0, 'missing role is not a warning condition');
});

test('iso-route: no resolved map on disk → existing behavior unchanged', async () => {
  const { iso, out } = mkIso();
  // Deliberately do NOT write a resolved map.
  await build({ source: iso, out, targets: ['claude'] });
  const fm = readAgentFrontmatter(out, 'planner');
  assert.equal(fm.model, undefined);
  assert.equal(fm.name, 'planner');
  assert.equal(fm.description, 'plans the work');
});

test('iso-route: malformed resolved JSON raises a clear error', async () => {
  const { iso, out } = mkIso();
  mkdirSync(join(out, '.claude'), { recursive: true });
  writeFileSync(join(out, '.claude', 'iso-route.resolved.json'), '{not valid json');
  await assert.rejects(
    () => build({ source: iso, out, targets: ['claude'] }),
    /iso-route\.resolved\.json/,
  );
});

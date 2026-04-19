#!/usr/bin/env node
// Local dogfood example for the wrapper CLI:
//   agent.md + iso/ source → iso plan/build → per-harness outputs
// It exercises the same local entrypoint that downstream repos use.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const out = resolve(here, 'out');
const renderedInstructions = resolve(here, 'iso', 'instructions.md');
const isoCli = resolve(repoRoot, 'packages', 'iso', 'bin', 'iso.mjs');

function run(cmd, args, cwd = repoRoot) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Ensure sibling CLIs exist before the wrapper resolves their local bins.
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/agentmd']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/isolint']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-route']);

// Show the planned steps, then run the full wrapper build.
run('node', [isoCli, 'plan', here, '--out', 'out']);
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
run('node', [isoCli, 'build', here, '--out', 'out']);

const expected = [
  'CLAUDE.md',
  '.claude/agents/workspace-researcher.md',
  '.claude/commands/release-check.md',
  '.claude/settings.json',
  '.claude/iso-route.resolved.json',
  '.codex/config.toml',
  '.mcp.json',
  '.cursor/rules/main.mdc',
  '.cursor/rules/agent-workspace-researcher.mdc',
  '.cursor/mcp.json',
  '.cursor/iso-route.md',
  'AGENTS.md',
  'opencode.json',
  '.opencode/agents/workspace-researcher.md',
  '.opencode/skills/release-check.md',
];
const missing = expected.filter((file) => !existsSync(resolve(out, file)));
if (missing.length) {
  console.error(`\nmissing expected outputs:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

if (!existsSync(renderedInstructions)) {
  console.error(`\nmissing rendered instructions at ${renderedInstructions}`);
  process.exit(1);
}
const instructions = readFileSync(renderedInstructions, 'utf8');
if (!instructions.includes('## Hard limits — must never be violated')) {
  console.error('\nrendered instructions did not include the expected compiled heading');
  process.exit(1);
}

// Integration #1 + #2 smoke: iso-route's resolved map must carry the
// workspace-researcher role, and iso-harness must have stamped its model
// onto the Claude subagent frontmatter.
const resolvedMap = JSON.parse(readFileSync(resolve(out, '.claude/iso-route.resolved.json'), 'utf8'));
if (resolvedMap.roles?.['workspace-researcher']?.model !== 'claude-opus-4-7') {
  console.error('\niso-route resolved map missing expected workspace-researcher role');
  process.exit(1);
}
const researcherAgent = readFileSync(resolve(out, '.claude/agents/workspace-researcher.md'), 'utf8');
if (!/^model:\s*claude-opus-4-7\b/m.test(researcherAgent)) {
  console.error('\niso-harness did not stamp model: claude-opus-4-7 onto workspace-researcher');
  process.exit(1);
}

console.log(`\ndogfood ok — iso wrapper generated ${expected.length} harness files under ${out}`);

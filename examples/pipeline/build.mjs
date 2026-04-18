#!/usr/bin/env node
// End-to-end demo of the iso monorepo pipeline:
//   agent.md → agentmd lint → agentmd render → isolint lint → iso-harness build
// Asserts that the expected per-harness files are produced. Run from anywhere;
// paths are resolved relative to this script.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const agentMd = resolve(here, 'agent.md');
const isoSrc = resolve(here, 'iso-src');
const renderedInstructions = resolve(isoSrc, 'instructions.md');
const out = resolve(here, 'out');

const agentmdCli = resolve(repoRoot, 'packages/agentmd/dist/cli.js');
const isolintCli = resolve(repoRoot, 'packages/isolint/dist/cli/index.js');
const isoHarnessBin = resolve(repoRoot, 'packages/iso-harness/bin/iso-harness.mjs');

function run(cmd, args, cwd = repoRoot) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 0. ensure sibling CLIs are built (iso-harness is plain .mjs, no build)
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/agentmd']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/isolint']);

// 1. agentmd lint — structural check of the authored source
run('node', [agentmdCli, 'lint', agentMd]);

// 2. agentmd render — compile to portable prose, placed where iso-harness looks for it
run('node', [agentmdCli, 'render', agentMd, '--out', renderedInstructions]);

// 3. isolint lint — ensure the rendered prose is safe for weak small models
run('node', [isolintCli, 'lint', renderedInstructions]);

// 4. iso-harness build — fan out one source into every target harness
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
run('node', [isoHarnessBin, 'build', '--source', isoSrc, '--out', out]);

// 5. assert every expected harness file was produced
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
const missing = expected.filter((f) => !existsSync(resolve(out, f)));
if (missing.length) {
  console.error(`\nmissing expected outputs:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `\npipeline ok — 1 authored agent.md → ${expected.length} harness files under ${out}`,
);

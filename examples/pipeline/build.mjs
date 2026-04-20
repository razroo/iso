#!/usr/bin/env node
// End-to-end demo of the iso monorepo pipeline — exercises all seven
// packages:
//
//   agent.md         → agentmd lint + render    (structure + compiled prose)
//   rendered prose   → isolint lint             (small-model-safe prose)
//   models.yaml      → iso-route build          (model policy → per-harness config)
//   iso-src/ + map   → iso-harness build        (one source → every harness)
//   eval suite       → iso-eval run             (behavioral score via fake runner)
//   sample session   → iso-trace stats          (observability on a real transcript)
//
// Asserts every expected harness file is produced AND that the
// iso-route → iso-harness handoff stamped model: onto the Claude
// subagent. Run from anywhere; paths resolve relative to this script.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const agentMd = resolve(here, 'agent.md');
const modelsYaml = resolve(here, 'models.yaml');
const isoSrc = resolve(here, 'iso-src');
const renderedInstructions = resolve(isoSrc, 'instructions.md');
const out = resolve(here, 'out');
const evalYml = resolve(here, 'eval', 'eval.yml');

const agentmdCli = resolve(repoRoot, 'packages/agentmd/dist/cli.js');
const isolintCli = resolve(repoRoot, 'packages/isolint/dist/cli/index.js');
const isoHarnessBin = resolve(repoRoot, 'packages/iso-harness/bin/iso-harness.mjs');
const isoRouteCli = resolve(repoRoot, 'packages/iso-route/dist/cli.js');
const isoEvalCli = resolve(repoRoot, 'packages/iso-eval/dist/cli.js');
const isoTraceCli = resolve(repoRoot, 'packages/iso-trace/dist/cli.js');
const traceSample = resolve(
  repoRoot,
  'packages/iso-trace/examples/sample-session.jsonl',
);

function run(cmd, args, cwd = repoRoot) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 0. build every TypeScript package so its dist/cli.js exists.
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/agentmd']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/isolint']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-route']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-eval']);
run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-trace']);

// 1. agentmd lint — structural check of the authored source
run('node', [agentmdCli, 'lint', agentMd]);

// 2. agentmd render — compile to portable prose, placed where iso-harness looks for it
run('node', [agentmdCli, 'render', agentMd, '--out', renderedInstructions]);

// 3. isolint lint — ensure the rendered prose is safe for weak small models
run('node', [isolintCli, 'lint', renderedInstructions]);

// 4. iso-route build — compile the model policy into per-harness config
//    so the resolved role map is on disk when iso-harness reads it.
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
run('node', [isoRouteCli, 'build', modelsYaml, '--out', out]);

// 5. iso-harness build — fan out one source into every target harness.
//    Picks up the resolved role map from step 4 and stamps the
//    `researcher` role's model onto the Claude subagent frontmatter.
run('node', [isoHarnessBin, 'build', '--source', isoSrc, '--out', out]);

// 6. iso-eval run — behavioral score against a tiny bundled suite.
//    Uses the deterministic `fake` runner so the pipeline is offline.
run('node', [isoEvalCli, 'run', evalYml]);

// 7. iso-trace stats — print observability stats on a bundled session.
run('node', [isoTraceCli, 'stats', '--source', traceSample]);

// 8. assert every expected harness file was produced
const expected = [
  // iso-harness outputs
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
  // iso-route outputs
  '.claude/settings.json',
  '.claude/iso-route.resolved.json',
  '.cursor/iso-route.md',
];
const missing = expected.filter((f) => !existsSync(resolve(out, f)));
if (missing.length) {
  console.error(`\nmissing expected outputs:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// 9. assert the iso-route → iso-harness handoff actually stamped a model
//    onto the Claude subagent. This is the cross-package contract from
//    INTEGRATIONS.md #1 + #2.
const resolvedMap = JSON.parse(
  readFileSync(resolve(out, '.claude/iso-route.resolved.json'), 'utf8'),
);
if (resolvedMap.roles?.researcher?.model !== 'claude-opus-4-7') {
  console.error('\nresolved role map missing expected researcher role');
  process.exit(1);
}
const researcherAgent = readFileSync(
  resolve(out, '.claude/agents/researcher.md'),
  'utf8',
);
if (!/^model:\s*claude-opus-4-7\b/m.test(researcherAgent)) {
  console.error(
    '\niso-harness did not stamp model: claude-opus-4-7 onto researcher subagent',
  );
  process.exit(1);
}

console.log(
  `\npipeline ok — all 7 packages exercised, ${expected.length} harness files under ${out}`,
);

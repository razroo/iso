#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function run(cmd, args, cwd = repoRoot, { capture = false } = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (capture) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status ?? 'null'})`);
  }
  return r;
}

function packWorkspace(pkgName, packsDir) {
  const r = run(
    'npm',
    ['pack', '--json', '--workspace', pkgName, '--pack-destination', packsDir],
    repoRoot,
    { capture: true },
  );
  const parsed = JSON.parse(r.stdout);
  const file = parsed[0]?.filename;
  if (!file) {
    throw new Error(`npm pack did not report a tarball filename for ${pkgName}`);
  }
  return resolve(packsDir, file);
}

function writePackageJson(dir) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, name: 'pack-smoke-fixture', type: 'module' }, null, 2) + '\n',
  );
}

function assertFiles(baseDir, expected) {
  const missing = expected.filter((file) => !existsSync(resolve(baseDir, file)));
  if (missing.length) {
    throw new Error(`missing expected outputs:\n  ${missing.join('\n  ')}`);
  }
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'iso-pack-smoke-'));
let failed = false;

try {
  // Ensure TypeScript package tarballs include fresh dist output.
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/agentmd']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/isolint']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-eval']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-trace']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-guard']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-ledger']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-context']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-cache']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-index']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-canon']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-preflight']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-postflight']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-redact']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-facts']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-migrate']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-contract']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-capabilities']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-score']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-timeline']);
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-route']);

  const packsDir = resolve(tmpRoot, 'packs');
  mkdirSync(packsDir, { recursive: true });

  const agentmdTgz = packWorkspace('@razroo/agentmd', packsDir);
  const isolintTgz = packWorkspace('@razroo/isolint', packsDir);
  const harnessTgz = packWorkspace('@razroo/iso-harness', packsDir);
  const isoTgz = packWorkspace('@razroo/iso', packsDir);
  const isoEvalTgz = packWorkspace('@razroo/iso-eval', packsDir);
  const isoTraceTgz = packWorkspace('@razroo/iso-trace', packsDir);
  const isoGuardTgz = packWorkspace('@razroo/iso-guard', packsDir);
  const isoLedgerTgz = packWorkspace('@razroo/iso-ledger', packsDir);
  const isoContextTgz = packWorkspace('@razroo/iso-context', packsDir);
  const isoCacheTgz = packWorkspace('@razroo/iso-cache', packsDir);
  const isoIndexTgz = packWorkspace('@razroo/iso-index', packsDir);
  const isoCanonTgz = packWorkspace('@razroo/iso-canon', packsDir);
  const isoPreflightTgz = packWorkspace('@razroo/iso-preflight', packsDir);
  const isoPostflightTgz = packWorkspace('@razroo/iso-postflight', packsDir);
  const isoRedactTgz = packWorkspace('@razroo/iso-redact', packsDir);
  const isoFactsTgz = packWorkspace('@razroo/iso-facts', packsDir);
  const isoMigrateTgz = packWorkspace('@razroo/iso-migrate', packsDir);
  const isoContractTgz = packWorkspace('@razroo/iso-contract', packsDir);
  const isoCapabilitiesTgz = packWorkspace('@razroo/iso-capabilities', packsDir);
  const isoScoreTgz = packWorkspace('@razroo/iso-score', packsDir);
  const isoTimelineTgz = packWorkspace('@razroo/iso-timeline', packsDir);
  const isoRouteTgz = packWorkspace('@razroo/iso-route', packsDir);

  // Smoke the packaged iso-harness CLI directly.
  const harnessDir = resolve(tmpRoot, 'iso-harness');
  mkdirSync(harnessDir, { recursive: true });
  writePackageJson(harnessDir);
  cpSync(resolve(repoRoot, 'packages', 'iso-harness', 'examples', 'minimal', 'iso'), resolve(harnessDir, 'iso'), {
    recursive: true,
  });
  run('npm', ['install', harnessTgz], harnessDir);
  run('npx', ['--no-install', 'iso-harness', '--version'], harnessDir);
  run('npx', ['--no-install', 'iso-harness', 'build', '--source', 'iso', '--out', 'out'], harnessDir);
  assertFiles(resolve(harnessDir, 'out'), [
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
  ]);

  // Smoke the packaged iso wrapper with local tarball dependencies.
  const isoDir = resolve(tmpRoot, 'iso');
  mkdirSync(isoDir, { recursive: true });
  writePackageJson(isoDir);
  cpSync(resolve(repoRoot, 'examples', 'dogfood', 'agent.md'), resolve(isoDir, 'agent.md'));
  cpSync(resolve(repoRoot, 'examples', 'dogfood', 'iso'), resolve(isoDir, 'iso'), { recursive: true });
  cpSync(
    resolve(repoRoot, 'examples', 'dogfood', 'models.yaml'),
    resolve(isoDir, 'models.yaml'),
  );
  run(
    'npm',
    ['install', agentmdTgz, isolintTgz, harnessTgz, isoRouteTgz, isoTgz],
    isoDir,
  );
  run('npx', ['--no-install', 'iso', '--version'], isoDir);
  run('npx', ['--no-install', 'iso', 'build', '.', '--out', 'out'], isoDir);
  assertFiles(resolve(isoDir, 'out'), [
    'CLAUDE.md',
    '.claude/agents/workspace-researcher.md',
    '.claude/commands/release-check.md',
    '.claude/settings.json',
    '.claude/iso-route.resolved.json',
    '.mcp.json',
    '.cursor/rules/main.mdc',
    '.cursor/rules/agent-workspace-researcher.mdc',
    '.cursor/mcp.json',
    '.cursor/iso-route.md',
    'AGENTS.md',
    '.codex/config.toml',
    'opencode.json',
    '.opencode/agents/workspace-researcher.md',
    '.opencode/skills/release-check.md',
  ]);
  const rendered = readFileSync(resolve(isoDir, 'iso', 'instructions.md'), 'utf8');
  if (!rendered.includes('## Hard limits — must never be violated')) {
    throw new Error('packaged iso build did not render compiled instructions as expected');
  }
  // Confirm the iso-route → iso-harness handoff survived packaging: the
  // resolved role map on disk should drive a model: line into the
  // workspace-researcher subagent's emitted frontmatter.
  const packedAgent = readFileSync(
    resolve(isoDir, 'out', '.claude', 'agents', 'workspace-researcher.md'),
    'utf8',
  );
  if (!/^model:\s*claude-opus-4-7\b/m.test(packedAgent)) {
    throw new Error(
      'packaged iso build did not stamp model: claude-opus-4-7 onto workspace-researcher',
    );
  }

  // Smoke the packaged iso-eval CLI against the bundled example suite.
  const isoEvalDir = resolve(tmpRoot, 'iso-eval');
  mkdirSync(isoEvalDir, { recursive: true });
  writePackageJson(isoEvalDir);
  cpSync(
    resolve(repoRoot, 'packages', 'iso-eval', 'examples', 'suites', 'echo-basic'),
    resolve(isoEvalDir, 'echo-basic'),
    { recursive: true },
  );
  run('npm', ['install', isoEvalTgz], isoEvalDir);
  run('npx', ['--no-install', 'iso-eval', '--version'], isoEvalDir);
  run('npx', ['--no-install', 'iso-eval', 'run', 'echo-basic/eval.yml'], isoEvalDir);

  // Smoke the packaged iso-trace CLI against the bundled example transcript.
  const isoTraceDir = resolve(tmpRoot, 'iso-trace');
  mkdirSync(isoTraceDir, { recursive: true });
  writePackageJson(isoTraceDir);
  run('npm', ['install', isoTraceTgz], isoTraceDir);
  run('npx', ['--no-install', 'iso-trace', '--version'], isoTraceDir);
  const fixturePath = resolve(
    isoTraceDir,
    'node_modules',
    '@razroo',
    'iso-trace',
    'examples',
    'sample-session.jsonl',
  );
  run('npx', ['--no-install', 'iso-trace', 'stats', '--source', fixturePath], isoTraceDir);

  // Smoke the packaged iso-guard CLI against the bundled JobForge-style policy.
  const isoGuardDir = resolve(tmpRoot, 'iso-guard');
  mkdirSync(isoGuardDir, { recursive: true });
  writePackageJson(isoGuardDir);
  run('npm', ['install', isoGuardTgz], isoGuardDir);
  const isoGuardVersion = run('npx', ['--no-install', 'iso-guard', '--version'], isoGuardDir, { capture: true });
  if (!isoGuardVersion.stdout.trim()) {
    throw new Error('packaged iso-guard --version produced no output');
  }
  const guardPolicyPath = resolve(
    isoGuardDir,
    'node_modules',
    '@razroo',
    'iso-guard',
    'examples',
    'jobforge-apply.yaml',
  );
  const guardEventsPath = resolve(isoGuardDir, 'events.json');
  writeFileSync(
    guardEventsPath,
    JSON.stringify([
      { type: 'tool_call', name: 'geometra_disconnect', data: { round: 1 } },
      { type: 'tool_call', name: 'task', data: { round: 1, mode: 'apply' } },
      { type: 'tool_call', name: 'job-forge-merge' },
      { type: 'tool_call', name: 'job-forge-verify' },
    ], null, 2),
  );
  const isoGuardAudit = run(
    'npx',
    ['--no-install', 'iso-guard', 'audit', guardPolicyPath, '--events', guardEventsPath],
    isoGuardDir,
    { capture: true },
  );
  if (!isoGuardAudit.stdout.includes('iso-guard: PASS')) {
    throw new Error('packaged iso-guard audit did not report PASS');
  }

  // Smoke the packaged iso-ledger CLI against the bundled example ledger.
  const isoLedgerDir = resolve(tmpRoot, 'iso-ledger');
  mkdirSync(isoLedgerDir, { recursive: true });
  writePackageJson(isoLedgerDir);
  run('npm', ['install', isoLedgerTgz], isoLedgerDir);
  run('npx', ['--no-install', 'iso-ledger', '--version'], isoLedgerDir);
  const ledgerPath = resolve(
    isoLedgerDir,
    'node_modules',
    '@razroo',
    'iso-ledger',
    'examples',
    'jobforge-events.jsonl',
  );
  run('npx', ['--no-install', 'iso-ledger', 'verify', '--ledger', ledgerPath], isoLedgerDir);
  run(
    'npx',
    ['--no-install', 'iso-ledger', 'has', '--ledger', ledgerPath, '--key', 'url:https://example.test/jobs/123'],
    isoLedgerDir,
  );

  // Smoke the packaged iso-context CLI against a small local project bundle.
  const isoContextDir = resolve(tmpRoot, 'iso-context');
  mkdirSync(isoContextDir, { recursive: true });
  writePackageJson(isoContextDir);
  mkdirSync(resolve(isoContextDir, 'iso'), { recursive: true });
  mkdirSync(resolve(isoContextDir, 'modes'), { recursive: true });
  writeFileSync(resolve(isoContextDir, 'iso', 'instructions.md'), '# Agent\n\nBase context.\n');
  writeFileSync(resolve(isoContextDir, 'modes', 'apply.md'), '# Apply\n\nApply context.\n');
  writeFileSync(resolve(isoContextDir, 'context.json'), JSON.stringify({
    defaults: { tokenBudget: 1000, charsPerToken: 4 },
    bundles: [
      { name: 'base', files: ['iso/instructions.md'] },
      {
        name: 'apply',
        extends: 'base',
        files: ['modes/apply.md', { path: 'modes/reference-geometra.md', required: false }],
      },
    ],
  }, null, 2));
  run('npm', ['install', isoContextTgz], isoContextDir);
  const isoContextVersion = run('npx', ['--no-install', 'iso-context', '--version'], isoContextDir, { capture: true });
  if (!isoContextVersion.stdout.trim()) {
    throw new Error('packaged iso-context --version produced no output');
  }
  run('npx', ['--no-install', 'iso-context', 'list', '--policy', 'context.json'], isoContextDir);
  const contextCheck = run(
    'npx',
    ['--no-install', 'iso-context', 'check', 'apply', '--policy', 'context.json', '--root', isoContextDir],
    isoContextDir,
    { capture: true },
  );
  if (!contextCheck.stdout.includes('iso-context: PASS')) {
    throw new Error('packaged iso-context check did not report PASS');
  }
  run('npx', ['--no-install', 'iso-context', 'render', 'apply', '--policy', 'context.json', '--root', isoContextDir], isoContextDir);

  // Smoke the packaged iso-cache CLI against a local content-addressed cache.
  const isoCacheDir = resolve(tmpRoot, 'iso-cache');
  mkdirSync(isoCacheDir, { recursive: true });
  writePackageJson(isoCacheDir);
  writeFileSync(resolve(isoCacheDir, 'job-description.md'), '# Example role\n\nBuild deterministic agent workflow tooling.\n');
  run('npm', ['install', isoCacheTgz], isoCacheDir);
  const isoCacheVersion = run('npx', ['--no-install', 'iso-cache', '--version'], isoCacheDir, { capture: true });
  if (!isoCacheVersion.stdout.trim()) {
    throw new Error('packaged iso-cache --version produced no output');
  }
  const cacheKey = run(
    'npx',
    ['--no-install', 'iso-cache', 'key', '--namespace', 'jobforge.jd', '--part', 'https://example.test/jobs/123'],
    isoCacheDir,
    { capture: true },
  ).stdout.trim();
  run(
    'npx',
    [
      '--no-install',
      'iso-cache',
      'put',
      cacheKey,
      '--kind',
      'jd',
      '--ttl',
      '7d',
      '--meta',
      '{"url":"https://example.test/jobs/123"}',
      '--input',
      '@job-description.md',
    ],
    isoCacheDir,
  );
  run('npx', ['--no-install', 'iso-cache', 'has', cacheKey], isoCacheDir);
  const cacheVerify = run('npx', ['--no-install', 'iso-cache', 'verify'], isoCacheDir, { capture: true });
  if (!cacheVerify.stdout.includes('iso-cache: PASS')) {
    throw new Error('packaged iso-cache verify did not report PASS');
  }

  // Smoke the packaged iso-index CLI against the bundled JobForge-style artifact index.
  const isoIndexDir = resolve(tmpRoot, 'iso-index');
  mkdirSync(isoIndexDir, { recursive: true });
  writePackageJson(isoIndexDir);
  run('npm', ['install', isoIndexTgz], isoIndexDir);
  const isoIndexVersion = run('npx', ['--no-install', 'iso-index', '--version'], isoIndexDir, { capture: true });
  if (!isoIndexVersion.stdout.trim()) {
    throw new Error('packaged iso-index --version produced no output');
  }
  const indexPackageDir = resolve(isoIndexDir, 'node_modules', '@razroo', 'iso-index');
  const indexConfigPath = resolve(indexPackageDir, 'examples', 'jobforge-index.json');
  const indexProjectRoot = resolve(indexPackageDir, 'examples', 'jobforge-project');
  const indexOutPath = resolve(isoIndexDir, '.iso-index.json');
  const indexBuild = run(
    'npx',
    ['--no-install', 'iso-index', 'build', '--config', indexConfigPath, '--root', indexProjectRoot, '--out', indexOutPath],
    isoIndexDir,
    { capture: true },
  );
  if (!indexBuild.stdout.includes('iso-index: BUILT')) {
    throw new Error('packaged iso-index build did not report BUILT');
  }
  run(
    'npx',
    ['--no-install', 'iso-index', 'has', '--index', indexOutPath, '--key', 'company-role:example-labs:staff-agent-engineer'],
    isoIndexDir,
  );
  const indexVerify = run('npx', ['--no-install', 'iso-index', 'verify', '--index', indexOutPath], isoIndexDir, { capture: true });
  if (!indexVerify.stdout.includes('iso-index: PASS')) {
    throw new Error('packaged iso-index verify did not report PASS');
  }

  // Smoke the packaged iso-canon CLI against the bundled JobForge-style canonicalization profile.
  const isoCanonDir = resolve(tmpRoot, 'iso-canon');
  mkdirSync(isoCanonDir, { recursive: true });
  writePackageJson(isoCanonDir);
  run('npm', ['install', isoCanonTgz], isoCanonDir);
  const isoCanonVersion = run('npx', ['--no-install', 'iso-canon', '--version'], isoCanonDir, { capture: true });
  if (!isoCanonVersion.stdout.trim()) {
    throw new Error('packaged iso-canon --version produced no output');
  }
  const canonConfigPath = resolve(
    isoCanonDir,
    'node_modules',
    '@razroo',
    'iso-canon',
    'examples',
    'jobforge-canon.json',
  );
  const canonKey = run(
    'npx',
    [
      '--no-install',
      'iso-canon',
      'key',
      'company-role',
      '--company',
      'Anthropic, PBC',
      '--role',
      'Senior SWE, AI Platform - Remote US',
      '--config',
      canonConfigPath,
      '--profile',
      'jobforge',
    ],
    isoCanonDir,
    { capture: true },
  );
  if (!canonKey.stdout.includes('company-role:anthropic:senior-software-engineer-ai-platform')) {
    throw new Error('packaged iso-canon key did not report the expected canonical key');
  }
  const canonCompare = run(
    'npx',
    ['--no-install', 'iso-canon', 'compare', 'company', 'OpenAI, Inc.', 'Open AI', '--config', canonConfigPath, '--profile', 'jobforge'],
    isoCanonDir,
    { capture: true },
  );
  if (!canonCompare.stdout.includes('iso-canon: SAME')) {
    throw new Error('packaged iso-canon compare did not report SAME');
  }

  // Smoke the packaged iso-score CLI against the bundled JobForge-style scoring rubric.
  const isoScoreDir = resolve(tmpRoot, 'iso-score');
  mkdirSync(isoScoreDir, { recursive: true });
  writePackageJson(isoScoreDir);
  run('npm', ['install', isoScoreTgz], isoScoreDir);
  const isoScoreVersion = run('npx', ['--no-install', 'iso-score', '--version'], isoScoreDir, { capture: true });
  if (!isoScoreVersion.stdout.trim()) {
    throw new Error('packaged iso-score --version produced no output');
  }
  const scorePackageDir = resolve(isoScoreDir, 'node_modules', '@razroo', 'iso-score');
  const scoreConfigPath = resolve(scorePackageDir, 'examples', 'jobforge-score.json');
  const scoreInputPath = resolve(scorePackageDir, 'examples', 'evaluation.json');
  const scoreAltPath = resolve(scorePackageDir, 'examples', 'evaluation-alt.json');
  const scoreOutPath = resolve(isoScoreDir, 'score-result.json');
  const scoreCompute = run(
    'npx',
    ['--no-install', 'iso-score', 'compute', '--config', scoreConfigPath, '--input', scoreInputPath, '--out', scoreOutPath],
    isoScoreDir,
    { capture: true },
  );
  if (!scoreCompute.stdout.includes('iso-score: SCORED')) {
    throw new Error('packaged iso-score compute did not report SCORED');
  }
  const scoreVerify = run(
    'npx',
    ['--no-install', 'iso-score', 'verify', '--score', scoreOutPath],
    isoScoreDir,
    { capture: true },
  );
  if (!scoreVerify.stdout.includes('iso-score: PASS')) {
    throw new Error('packaged iso-score verify did not report PASS');
  }
  const scoreCheck = run(
    'npx',
    ['--no-install', 'iso-score', 'check', '--config', scoreConfigPath, '--input', scoreInputPath],
    isoScoreDir,
    { capture: true },
  );
  if (!scoreCheck.stdout.includes('iso-score: PASS')) {
    throw new Error('packaged iso-score check did not report PASS');
  }
  const scoreGate = run(
    'npx',
    ['--no-install', 'iso-score', 'gate', '--config', scoreConfigPath, '--input', scoreInputPath, '--gate', 'apply'],
    isoScoreDir,
    { capture: true },
  );
  if (!scoreGate.stdout.includes('iso-score: PASS')) {
    throw new Error('packaged iso-score gate did not report PASS');
  }
  const scoreCompare = run(
    'npx',
    ['--no-install', 'iso-score', 'compare', '--config', scoreConfigPath, '--left', scoreInputPath, '--right', scoreAltPath],
    isoScoreDir,
    { capture: true },
  );
  if (!scoreCompare.stdout.includes('iso-score: WINNER left')) {
    throw new Error('packaged iso-score compare did not report WINNER left');
  }
  run('npx', ['--no-install', 'iso-score', 'explain', '--config', scoreConfigPath], isoScoreDir);

  // Smoke the packaged iso-timeline CLI against the bundled JobForge-style next-action policy.
  const isoTimelineDir = resolve(tmpRoot, 'iso-timeline');
  mkdirSync(isoTimelineDir, { recursive: true });
  writePackageJson(isoTimelineDir);
  run('npm', ['install', isoTimelineTgz], isoTimelineDir);
  const isoTimelineVersion = run('npx', ['--no-install', 'iso-timeline', '--version'], isoTimelineDir, { capture: true });
  if (!isoTimelineVersion.stdout.trim()) {
    throw new Error('packaged iso-timeline --version produced no output');
  }
  const timelinePackageDir = resolve(isoTimelineDir, 'node_modules', '@razroo', 'iso-timeline');
  const timelineConfigPath = resolve(timelinePackageDir, 'examples', 'jobforge-timeline.json');
  const timelineEventsPath = resolve(timelinePackageDir, 'examples', 'jobforge-events.jsonl');
  const timelineOutPath = resolve(isoTimelineDir, 'timeline-result.json');
  const timelinePlan = run(
    'npx',
    ['--no-install', 'iso-timeline', 'plan', '--config', timelineConfigPath, '--events', timelineEventsPath, '--now', '2026-04-27T00:00:00.000Z', '--out', timelineOutPath],
    isoTimelineDir,
    { capture: true },
  );
  if (!timelinePlan.stdout.includes('iso-timeline: PLAN')) {
    throw new Error('packaged iso-timeline plan did not report PLAN');
  }
  const timelineDue = run(
    'npx',
    ['--no-install', 'iso-timeline', 'due', '--config', timelineConfigPath, '--events', timelineEventsPath, '--now', '2026-04-27T00:00:00.000Z'],
    isoTimelineDir,
    { capture: true },
  );
  if (!timelineDue.stdout.includes('iso-timeline: PLAN')) {
    throw new Error('packaged iso-timeline due did not report PLAN');
  }
  const timelineVerify = run(
    'npx',
    ['--no-install', 'iso-timeline', 'verify', '--timeline', timelineOutPath],
    isoTimelineDir,
    { capture: true },
  );
  if (!timelineVerify.stdout.includes('iso-timeline: PASS')) {
    throw new Error('packaged iso-timeline verify did not report PASS');
  }
  const timelineCheck = run(
    'npx',
    ['--no-install', 'iso-timeline', 'check', '--config', timelineConfigPath, '--events', timelineEventsPath, '--now', '2026-04-27T00:00:00.000Z', '--fail-on', 'none'],
    isoTimelineDir,
    { capture: true },
  );
  if (!timelineCheck.stdout.includes('iso-timeline: PASS')) {
    throw new Error('packaged iso-timeline check did not report PASS');
  }
  run('npx', ['--no-install', 'iso-timeline', 'explain', '--config', timelineConfigPath], isoTimelineDir);

  // Smoke the packaged iso-preflight CLI against the bundled JobForge-style preflight plan.
  const isoPreflightDir = resolve(tmpRoot, 'iso-preflight');
  mkdirSync(isoPreflightDir, { recursive: true });
  writePackageJson(isoPreflightDir);
  run('npm', ['install', isoPreflightTgz], isoPreflightDir);
  const isoPreflightVersion = run('npx', ['--no-install', 'iso-preflight', '--version'], isoPreflightDir, { capture: true });
  if (!isoPreflightVersion.stdout.trim()) {
    throw new Error('packaged iso-preflight --version produced no output');
  }
  const preflightPackageDir = resolve(isoPreflightDir, 'node_modules', '@razroo', 'iso-preflight');
  const preflightConfigPath = resolve(preflightPackageDir, 'examples', 'jobforge-preflight.json');
  const preflightCandidatesPath = resolve(preflightPackageDir, 'examples', 'jobforge-candidates.json');
  const preflightPlan = run(
    'npx',
    ['--no-install', 'iso-preflight', 'plan', '--config', preflightConfigPath, '--candidates', preflightCandidatesPath],
    isoPreflightDir,
    { capture: true },
  );
  if (!preflightPlan.stdout.includes('iso-preflight: PLAN')) {
    throw new Error('packaged iso-preflight plan did not report PLAN');
  }
  const preflightCheck = run(
    'npx',
    ['--no-install', 'iso-preflight', 'check', '--config', preflightConfigPath, '--candidates', preflightCandidatesPath],
    isoPreflightDir,
    { capture: true },
  );
  if (!preflightCheck.stdout.includes('iso-preflight: PASS')) {
    throw new Error('packaged iso-preflight check did not report PASS');
  }

  // Smoke the packaged iso-postflight CLI against the bundled JobForge-style settlement plan.
  const isoPostflightDir = resolve(tmpRoot, 'iso-postflight');
  mkdirSync(isoPostflightDir, { recursive: true });
  writePackageJson(isoPostflightDir);
  run('npm', ['install', isoPostflightTgz], isoPostflightDir);
  const isoPostflightVersion = run('npx', ['--no-install', 'iso-postflight', '--version'], isoPostflightDir, { capture: true });
  if (!isoPostflightVersion.stdout.trim()) {
    throw new Error('packaged iso-postflight --version produced no output');
  }
  const postflightPackageDir = resolve(isoPostflightDir, 'node_modules', '@razroo', 'iso-postflight');
  const postflightConfigPath = resolve(postflightPackageDir, 'examples', 'jobforge-postflight.json');
  const postflightPlanPath = resolve(postflightPackageDir, 'examples', 'jobforge-plan.json');
  const postflightPartialPath = resolve(postflightPackageDir, 'examples', 'jobforge-outcomes-partial.json');
  const postflightCompletePath = resolve(postflightPackageDir, 'examples', 'jobforge-outcomes-complete.json');
  const postflightStatus = run(
    'npx',
    ['--no-install', 'iso-postflight', 'status', '--config', postflightConfigPath, '--plan', postflightPlanPath, '--outcomes', postflightPartialPath],
    isoPostflightDir,
    { capture: true },
  );
  if (!postflightStatus.stdout.includes('iso-postflight: STATUS')) {
    throw new Error('packaged iso-postflight status did not report STATUS');
  }
  const postflightCheck = run(
    'npx',
    ['--no-install', 'iso-postflight', 'check', '--config', postflightConfigPath, '--plan', postflightPlanPath, '--outcomes', postflightCompletePath],
    isoPostflightDir,
    { capture: true },
  );
  if (!postflightCheck.stdout.includes('iso-postflight: PASS')) {
    throw new Error('packaged iso-postflight check did not report PASS');
  }

  // Smoke the packaged iso-redact CLI against the bundled JobForge-style redaction policy.
  const isoRedactDir = resolve(tmpRoot, 'iso-redact');
  mkdirSync(isoRedactDir, { recursive: true });
  writePackageJson(isoRedactDir);
  run('npm', ['install', isoRedactTgz], isoRedactDir);
  const isoRedactVersion = run('npx', ['--no-install', 'iso-redact', '--version'], isoRedactDir, { capture: true });
  if (!isoRedactVersion.stdout.trim()) {
    throw new Error('packaged iso-redact --version produced no output');
  }
  const redactPackageDir = resolve(isoRedactDir, 'node_modules', '@razroo', 'iso-redact');
  const redactConfigPath = resolve(redactPackageDir, 'examples', 'jobforge-redact.json');
  const redactInputPath = resolve(redactPackageDir, 'examples', 'leaky-input.txt');
  const redactOutputPath = resolve(isoRedactDir, 'safe.txt');
  const redactScan = run(
    'npx',
    ['--no-install', 'iso-redact', 'scan', '--config', redactConfigPath, '--input', redactInputPath],
    isoRedactDir,
    { capture: true },
  );
  if (!redactScan.stdout.includes('iso-redact: FOUND')) {
    throw new Error('packaged iso-redact scan did not report FOUND');
  }
  run(
    'npx',
    ['--no-install', 'iso-redact', 'apply', '--config', redactConfigPath, '--input', redactInputPath, '--output', redactOutputPath],
    isoRedactDir,
  );
  const redactVerify = run(
    'npx',
    ['--no-install', 'iso-redact', 'verify', '--config', redactConfigPath, '--input', redactOutputPath],
    isoRedactDir,
    { capture: true },
  );
  if (!redactVerify.stdout.includes('iso-redact: PASS')) {
    throw new Error('packaged iso-redact verify did not report PASS');
  }
  run('npx', ['--no-install', 'iso-redact', 'explain', '--config', redactConfigPath], isoRedactDir);

  // Smoke the packaged iso-facts CLI against the bundled JobForge-style fact policy.
  const isoFactsDir = resolve(tmpRoot, 'iso-facts');
  mkdirSync(isoFactsDir, { recursive: true });
  writePackageJson(isoFactsDir);
  run('npm', ['install', isoFactsTgz], isoFactsDir);
  const isoFactsVersion = run('npx', ['--no-install', 'iso-facts', '--version'], isoFactsDir, { capture: true });
  if (!isoFactsVersion.stdout.trim()) {
    throw new Error('packaged iso-facts --version produced no output');
  }
  const factsPackageDir = resolve(isoFactsDir, 'node_modules', '@razroo', 'iso-facts');
  mkdirSync(resolve(isoFactsDir, 'reports'), { recursive: true });
  mkdirSync(resolve(isoFactsDir, 'data'), { recursive: true });
  mkdirSync(resolve(isoFactsDir, 'batch'), { recursive: true });
  cpSync(resolve(factsPackageDir, 'examples', 'report.md'), resolve(isoFactsDir, 'reports', '001-example.md'));
  cpSync(resolve(factsPackageDir, 'examples', 'scan-history.tsv'), resolve(isoFactsDir, 'data', 'scan-history.tsv'));
  cpSync(resolve(factsPackageDir, 'examples', 'preflight-candidates.json'), resolve(isoFactsDir, 'batch', 'preflight-candidates.json'));
  const factsConfigPath = resolve(factsPackageDir, 'examples', 'jobforge-facts.json');
  const factsOutPath = resolve(isoFactsDir, '.iso-facts.json');
  const factsBuild = run(
    'npx',
    ['--no-install', 'iso-facts', 'build', '--config', factsConfigPath, '--root', isoFactsDir, '--out', factsOutPath],
    isoFactsDir,
    { capture: true },
  );
  if (!factsBuild.stdout.includes('iso-facts: BUILT')) {
    throw new Error('packaged iso-facts build did not report BUILT');
  }
  const factsQuery = run(
    'npx',
    ['--no-install', 'iso-facts', 'query', '--facts', factsOutPath, '--fact', 'job.url'],
    isoFactsDir,
    { capture: true },
  );
  if (!factsQuery.stdout.includes('job.url')) {
    throw new Error('packaged iso-facts query did not return job.url');
  }
  const factsHas = run(
    'npx',
    ['--no-install', 'iso-facts', 'has', '--facts', factsOutPath, '--fact', 'job.score'],
    isoFactsDir,
    { capture: true },
  );
  if (!factsHas.stdout.includes('iso-facts: MATCH')) {
    throw new Error('packaged iso-facts has did not report MATCH');
  }
  const factsVerify = run(
    'npx',
    ['--no-install', 'iso-facts', 'verify', '--facts', factsOutPath],
    isoFactsDir,
    { capture: true },
  );
  if (!factsVerify.stdout.includes('iso-facts: PASS')) {
    throw new Error('packaged iso-facts verify did not report PASS');
  }
  const factsCheck = run(
    'npx',
    ['--no-install', 'iso-facts', 'check', '--facts', factsOutPath, '--config', factsConfigPath],
    isoFactsDir,
    { capture: true },
  );
  if (!factsCheck.stdout.includes('iso-facts: PASS')) {
    throw new Error('packaged iso-facts check did not report PASS');
  }
  run('npx', ['--no-install', 'iso-facts', 'explain', '--config', factsConfigPath], isoFactsDir);

  // Smoke the packaged iso-migrate CLI against a JobForge-style consumer upgrade.
  const isoMigrateDir = resolve(tmpRoot, 'iso-migrate');
  mkdirSync(isoMigrateDir, { recursive: true });
  writeFileSync(
    resolve(isoMigrateDir, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'iso-migrate-pack-smoke',
      type: 'module',
      scripts: { verify: 'job-forge verify' },
      dependencies: { 'job-forge': '^2.14.22' },
    }, null, 2) + '\n',
  );
  writeFileSync(resolve(isoMigrateDir, '.gitignore'), '# Generated\n.resolved-prompt-*\nnode_modules/\n');
  run('npm', ['install', isoMigrateTgz], isoMigrateDir);
  const isoMigrateVersion = run('npx', ['--no-install', 'iso-migrate', '--version'], isoMigrateDir, { capture: true });
  if (!isoMigrateVersion.stdout.trim()) {
    throw new Error('packaged iso-migrate --version produced no output');
  }
  const migrateConfigPath = resolve(
    isoMigrateDir,
    'node_modules',
    '@razroo',
    'iso-migrate',
    'examples',
    'jobforge-consumer-migrations.json',
  );
  const migratePlan = run(
    'npx',
    ['--no-install', 'iso-migrate', 'plan', '--config', migrateConfigPath, '--root', isoMigrateDir],
    isoMigrateDir,
    { capture: true },
  );
  if (!migratePlan.stdout.includes('iso-migrate: PLAN')) {
    throw new Error('packaged iso-migrate plan did not report PLAN');
  }
  const migrateApply = run(
    'npx',
    ['--no-install', 'iso-migrate', 'apply', '--config', migrateConfigPath, '--root', isoMigrateDir],
    isoMigrateDir,
    { capture: true },
  );
  if (!migrateApply.stdout.includes('iso-migrate: APPLIED')) {
    throw new Error('packaged iso-migrate apply did not report APPLIED');
  }
  const migrateCheck = run(
    'npx',
    ['--no-install', 'iso-migrate', 'check', '--config', migrateConfigPath, '--root', isoMigrateDir],
    isoMigrateDir,
    { capture: true },
  );
  if (!migrateCheck.stdout.includes('iso-migrate: PASS')) {
    throw new Error('packaged iso-migrate check did not report PASS');
  }

  // Smoke the packaged iso-contract CLI against the bundled JobForge-style contract.
  const isoContractDir = resolve(tmpRoot, 'iso-contract');
  mkdirSync(isoContractDir, { recursive: true });
  writePackageJson(isoContractDir);
  run('npm', ['install', isoContractTgz], isoContractDir);
  const isoContractVersion = run('npx', ['--no-install', 'iso-contract', '--version'], isoContractDir, { capture: true });
  if (!isoContractVersion.stdout.trim()) {
    throw new Error('packaged iso-contract --version produced no output');
  }
  const contractsPath = resolve(
    isoContractDir,
    'node_modules',
    '@razroo',
    'iso-contract',
    'examples',
    'jobforge-contracts.json',
  );
  const trackerRowPath = resolve(
    isoContractDir,
    'node_modules',
    '@razroo',
    'iso-contract',
    'examples',
    'tracker-row.json',
  );
  run(
    'npx',
    ['--no-install', 'iso-contract', 'validate', 'jobforge.tracker-row', '--contracts', contractsPath, '--input', `@${trackerRowPath}`],
    isoContractDir,
  );
  run(
    'npx',
    ['--no-install', 'iso-contract', 'render', 'jobforge.tracker-row', '--contracts', contractsPath, '--input', `@${trackerRowPath}`, '--format', 'tsv'],
    isoContractDir,
  );

  // Smoke the packaged iso-capabilities CLI against the bundled JobForge-style policy.
  const isoCapabilitiesDir = resolve(tmpRoot, 'iso-capabilities');
  mkdirSync(isoCapabilitiesDir, { recursive: true });
  writePackageJson(isoCapabilitiesDir);
  run('npm', ['install', isoCapabilitiesTgz], isoCapabilitiesDir);
  const isoCapabilitiesVersion = run('npx', ['--no-install', 'iso-capabilities', '--version'], isoCapabilitiesDir, { capture: true });
  if (!isoCapabilitiesVersion.stdout.trim()) {
    throw new Error('packaged iso-capabilities --version produced no output');
  }
  const capabilitiesPath = resolve(
    isoCapabilitiesDir,
    'node_modules',
    '@razroo',
    'iso-capabilities',
    'examples',
    'jobforge-capabilities.json',
  );
  run('npx', ['--no-install', 'iso-capabilities', 'list', '--policy', capabilitiesPath], isoCapabilitiesDir);
  const capabilityCheck = run(
    'npx',
    [
      '--no-install',
      'iso-capabilities',
      'check',
      'applicant',
      '--policy',
      capabilitiesPath,
      '--tool',
      'browser',
      '--mcp',
      'geometra',
      '--command',
      'npx job-forge merge',
      '--filesystem',
      'write',
      '--network',
      'restricted',
    ],
    isoCapabilitiesDir,
    { capture: true },
  );
  if (!capabilityCheck.stdout.includes('iso-capabilities: PASS')) {
    throw new Error('packaged iso-capabilities check did not report PASS');
  }
  run(
    'npx',
    ['--no-install', 'iso-capabilities', 'render', 'applicant', '--policy', capabilitiesPath, '--target', 'opencode'],
    isoCapabilitiesDir,
  );

  // Smoke the packaged iso-route CLI against the bundled example policy.
  const isoRouteDir = resolve(tmpRoot, 'iso-route');
  mkdirSync(isoRouteDir, { recursive: true });
  writePackageJson(isoRouteDir);
  run('npm', ['install', isoRouteTgz], isoRouteDir);
  run('npx', ['--no-install', 'iso-route', '--version'], isoRouteDir);
  const modelsPath = resolve(
    isoRouteDir,
    'node_modules',
    '@razroo',
    'iso-route',
    'examples',
    'models.yaml',
  );
  run(
    'npx',
    ['--no-install', 'iso-route', 'build', modelsPath, '--out', resolve(isoRouteDir, 'out'), '--dry-run'],
    isoRouteDir,
  );
  run('npx', ['--no-install', 'iso-route', 'plan', modelsPath], isoRouteDir);

  console.log(
    `\npack smoke ok — verified packaged iso-harness, iso, iso-eval, iso-trace, iso-guard, iso-ledger, iso-context, iso-cache, iso-index, iso-canon, iso-score, iso-timeline, iso-preflight, iso-postflight, iso-redact, iso-facts, iso-migrate, iso-contract, iso-capabilities, and iso-route from ${tmpRoot}`,
  );
} catch (err) {
  failed = true;
  console.error(`\npack smoke failed — temp data kept at ${tmpRoot}`);
  throw err;
} finally {
  if (!failed) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

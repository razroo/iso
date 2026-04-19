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
  run('npm', ['--silent', 'run', 'build', '--workspace', '@razroo/iso-route']);

  const packsDir = resolve(tmpRoot, 'packs');
  mkdirSync(packsDir, { recursive: true });

  const agentmdTgz = packWorkspace('@razroo/agentmd', packsDir);
  const isolintTgz = packWorkspace('@razroo/isolint', packsDir);
  const harnessTgz = packWorkspace('@razroo/iso-harness', packsDir);
  const isoTgz = packWorkspace('@razroo/iso', packsDir);
  const isoEvalTgz = packWorkspace('@razroo/iso-eval', packsDir);
  const isoTraceTgz = packWorkspace('@razroo/iso-trace', packsDir);
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
  run('npm', ['install', agentmdTgz, isolintTgz, harnessTgz, isoTgz], isoDir);
  run('npx', ['--no-install', 'iso', '--version'], isoDir);
  run('npx', ['--no-install', 'iso', 'build', '.', '--out', 'out'], isoDir);
  assertFiles(resolve(isoDir, 'out'), [
    'CLAUDE.md',
    '.claude/agents/workspace-researcher.md',
    '.claude/commands/release-check.md',
    '.mcp.json',
    '.cursor/rules/main.mdc',
    '.cursor/rules/agent-workspace-researcher.mdc',
    '.cursor/mcp.json',
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
    `\npack smoke ok — verified packaged iso-harness, iso, iso-eval, iso-trace, and iso-route from ${tmpRoot}`,
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { planPipeline, runPipeline } from '../src/index.mjs';

const CLI = fileURLToPath(new URL('../bin/iso.mjs', import.meta.url));

function mkProject({ agentMd = '# Agent\n', instructions = '# Instructions\n', withAgentMd = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'iso-pipeline-'));
  const isoDir = join(dir, 'iso');
  mkdirSync(join(isoDir, 'agents'), { recursive: true });
  mkdirSync(join(isoDir, 'commands'), { recursive: true });
  writeFileSync(join(isoDir, 'mcp.json'), JSON.stringify({ servers: {} }, null, 2));
  writeFileSync(join(isoDir, 'instructions.md'), instructions);
  if (withAgentMd) {
    writeFileSync(join(dir, 'agent.md'), agentMd);
  }
  return dir;
}

test('planPipeline: agent.md project schedules structural, prose, and harness steps', () => {
  const dir = mkProject();
  const plan = planPipeline(dir, { target: 'claude,cursor', out: 'dist' });
  assert.equal(plan.hasAgentMd, true);
  assert.equal(plan.outDir, resolve(dir, 'dist'));
  assert.deepEqual(
    plan.steps.map((step) => step.label),
    [
      'agentmd lint (structural check)',
      'agentmd render → iso/instructions.md',
      'isolint lint (portable prose)',
      'iso-harness build (fan out to claude,cursor)',
    ],
  );
  assert.deepEqual(plan.steps.at(-1).args.slice(-2), ['--target', 'claude,cursor']);
  assert.equal(plan.steps.at(-1).args[4], resolve(dir, 'dist'));
});

test('planPipeline: instructions-only project skips agentmd and can skip isolint', () => {
  const dir = mkProject({ withAgentMd: false });
  const plan = planPipeline(dir, { skipIsolint: true });
  assert.equal(plan.hasAgentMd, false);
  assert.deepEqual(
    plan.steps.map((step) => step.label),
    ['iso-harness build (fan out to all four harnesses)'],
  );
});

test('runPipeline: delegates each planned step to the injected subprocess runner', () => {
  const dir = mkProject();
  const seen = [];
  const plan = runPipeline(
    dir,
    { dryRun: true },
    {
      write: () => {},
      spawnSync(cmd, args, opts) {
        seen.push({ cmd, args, opts });
        return { status: 0 };
      },
    },
  );
  assert.equal(seen.length, plan.steps.length);
  assert.ok(seen.every((call) => call.cmd === process.execPath));
  assert.ok(seen.every((call) => call.opts?.stdio === 'inherit'));
  assert.equal(seen.at(-1).args.at(-1), '--dry-run');
});

test('CLI: plan prints a readable summary for a project', () => {
  const dir = mkProject();
  const result = spawnSync(process.execPath, [CLI, 'plan', dir, '--target', 'codex'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /iso: /);
  assert.match(result.stdout, /steps:\s+4/);
  assert.match(result.stdout, /iso-harness build \(fan out to codex\)/);
});

test('CLI: build can wrap iso-harness for instructions-only projects', () => {
  const dir = mkProject({ withAgentMd: false });
  const outDir = join(dir, 'out');
  const result = spawnSync(
    process.execPath,
    [CLI, 'build', dir, '--skip-isolint', '--dry-run', '--out', 'out', '--target', 'claude'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /iso-harness \(dry-run\): loaded/);
  assert.equal(existsSync(outDir), false);
});

test('planPipeline: missing iso directory fails clearly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iso-missing-'));
  assert.throws(() => planPipeline(dir), /No iso\/ source directory found/);
  rmSync(dir, { recursive: true, force: true });
});

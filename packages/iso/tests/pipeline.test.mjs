import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { planPipeline, runPipeline } from '../src/index.mjs';

const CLI = fileURLToPath(new URL('../bin/iso.mjs', import.meta.url));

function mkProject({
  agentMd = '# Agent\n',
  instructions = '# Instructions\n',
  withAgentMd = true,
  modelsYaml = null,
  modelsLocation = 'root',
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'iso-pipeline-'));
  const isoDir = join(dir, 'iso');
  mkdirSync(join(isoDir, 'agents'), { recursive: true });
  mkdirSync(join(isoDir, 'commands'), { recursive: true });
  writeFileSync(join(isoDir, 'mcp.json'), JSON.stringify({ servers: {} }, null, 2));
  writeFileSync(join(isoDir, 'instructions.md'), instructions);
  if (withAgentMd) {
    writeFileSync(join(dir, 'agent.md'), agentMd);
  }
  if (modelsYaml) {
    const loc = modelsLocation === 'iso' ? join(isoDir, 'models.yaml') : join(dir, 'models.yaml');
    writeFileSync(loc, modelsYaml);
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

test('planPipeline: models.yaml at project root inserts iso-route before iso-harness', () => {
  const dir = mkProject({
    modelsYaml: 'default:\n  provider: anthropic\n  model: claude-sonnet-4-6\n',
  });
  const plan = planPipeline(dir);
  const labels = plan.steps.map((s) => s.label);
  const routeIdx = labels.findIndex((l) => l.startsWith('iso-route'));
  const harnessIdx = labels.findIndex((l) => l.startsWith('iso-harness'));
  assert.ok(routeIdx !== -1, `iso-route step missing: ${labels.join(' | ')}`);
  assert.ok(routeIdx < harnessIdx, 'iso-route must run before iso-harness');
  assert.equal(plan.modelsYaml, resolve(dir, 'models.yaml'));
});

test('planPipeline: iso/models.yaml is detected when project root is empty', () => {
  const dir = mkProject({
    modelsYaml: 'default:\n  provider: anthropic\n  model: claude-sonnet-4-6\n',
    modelsLocation: 'iso',
  });
  const plan = planPipeline(dir);
  assert.ok(plan.steps.some((s) => s.label.startsWith('iso-route')));
  assert.equal(plan.modelsYaml, resolve(dir, 'iso/models.yaml'));
});

test('planPipeline: project root models.yaml wins over iso/models.yaml', () => {
  const dir = mkProject({
    modelsYaml: 'default:\n  provider: anthropic\n  model: claude-sonnet-4-6\n',
    modelsLocation: 'root',
  });
  writeFileSync(
    join(dir, 'iso', 'models.yaml'),
    'default:\n  provider: openai\n  model: gpt-5\n',
  );
  const plan = planPipeline(dir);
  assert.equal(plan.modelsYaml, resolve(dir, 'models.yaml'));
});

test('planPipeline: no iso-route step when no models.yaml present', () => {
  const dir = mkProject();
  const plan = planPipeline(dir);
  assert.equal(plan.modelsYaml, null);
  assert.ok(!plan.steps.some((s) => s.label.startsWith('iso-route')));
});

test('planPipeline: --skip-iso-route omits the step even when models.yaml exists', () => {
  const dir = mkProject({
    modelsYaml: 'default:\n  provider: anthropic\n  model: claude-sonnet-4-6\n',
  });
  const plan = planPipeline(dir, { skipIsoRoute: true });
  assert.equal(plan.modelsYaml, null);
  assert.ok(!plan.steps.some((s) => s.label.startsWith('iso-route')));
});

test('planPipeline: --dry-run is forwarded to the iso-route step', () => {
  const dir = mkProject({
    modelsYaml: 'default:\n  provider: anthropic\n  model: claude-sonnet-4-6\n',
  });
  const plan = planPipeline(dir, { dryRun: true });
  const routeStep = plan.steps.find((s) => s.label.startsWith('iso-route'));
  assert.ok(routeStep);
  assert.ok(routeStep.args.includes('--dry-run'));
});

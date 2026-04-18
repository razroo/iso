// Core pipeline orchestration. Exposed as a library so the CLI and tests
// can drive it the same way.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

function siblingBin(pkgName, binName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkgDir = path.dirname(pkgJsonPath);
  const pkgJson = require(pkgJsonPath);
  const bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[binName];
  if (!bin) {
    throw new Error(`Package ${pkgName} has no bin named "${binName}"`);
  }
  return path.resolve(pkgDir, bin);
}

const AGENTMD_BIN = siblingBin('@razroo/agentmd', 'agentmd');
const ISOLINT_BIN = siblingBin('@razroo/isolint', 'isolint');
const ISO_HARNESS_BIN = siblingBin('@razroo/iso-harness', 'iso-harness');

// Run one subprocess step. `stdio: inherit` so user sees the child's output
// live — progress bars, warnings, summaries all pass through unchanged.
function runStep(label, bin, args, deps = {}) {
  const spawn = deps.spawnSync ?? spawnSync;
  const write = deps.write ?? ((line) => process.stdout.write(line));
  write(`\n▶ ${label}\n`);
  const r = spawn(process.execPath, [bin, ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status ?? 'null'})`);
  }
}

export function planPipeline(projectDir, opts = {}) {
  const abs = path.resolve(projectDir);
  const agentMd = path.join(abs, 'agent.md');
  const isoDir = path.join(abs, 'iso');
  const instructionsMd = path.join(isoDir, 'instructions.md');
  const outDir = opts.out ? path.resolve(abs, opts.out) : abs;
  const hasAgentMd = existsSync(agentMd);
  const hasIsoDir = existsSync(isoDir);

  if (!hasIsoDir) {
    throw new Error(
      `No iso/ source directory found at ${isoDir}. An iso project needs at minimum an iso/ subdirectory with agents/, commands/, mcp.json.`,
    );
  }

  const steps = [];
  if (hasAgentMd) {
    steps.push({
      label: 'agentmd lint (structural check)',
      bin: AGENTMD_BIN,
      args: ['lint', agentMd],
    });
    steps.push({
      label: `agentmd render → ${path.relative(abs, instructionsMd)}`,
      bin: AGENTMD_BIN,
      args: ['render', agentMd, '--out', instructionsMd],
    });
  }
  if (hasAgentMd || existsSync(instructionsMd)) {
    if (!opts.skipIsolint) {
      steps.push({
        label: 'isolint lint (portable prose)',
        bin: ISOLINT_BIN,
        args: ['lint', instructionsMd, '--fail-on', 'error'],
      });
    }
  }
  const harnessArgs = ['build', '--source', isoDir, '--out', outDir];
  if (opts.dryRun) harnessArgs.push('--dry-run');
  if (opts.target) harnessArgs.push('--target', opts.target);
  steps.push({
    label: `iso-harness build (fan out to ${opts.target ?? 'all four harnesses'})`,
    bin: ISO_HARNESS_BIN,
    args: harnessArgs,
  });
  return { projectDir: abs, hasAgentMd, hasIsoDir, outDir, steps };
}

export function runPipeline(projectDir, opts = {}, deps = {}) {
  const plan = planPipeline(projectDir, opts);
  for (const step of plan.steps) {
    runStep(step.label, step.bin, step.args, deps);
  }
  return plan;
}

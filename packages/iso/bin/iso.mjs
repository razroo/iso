#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPipeline, runPipeline } from '../src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const USAGE = `iso — authored source in, every coding-agent harness out

Usage:
  iso --version
  iso [build] [project-dir] [--out <dir>] [--target <list>]
      [--skip-isolint] [--dry-run]
  iso plan [project-dir] [--out <dir>] [--target <list>]
      [--skip-isolint] [--dry-run]

Commands:
  build     Run the full pipeline (default).
  plan      Print the steps that would run, without executing them.

Flags:
  --out <dir>         Output directory for generated harness files.
  --target <list>     Comma-separated targets: claude,cursor,codex,opencode
  --skip-isolint      Skip the portable-prose lint step.
  --dry-run           Pass through to iso-harness: show planned writes only.
`;

function readVersion() {
  const pkgPath = resolve(here, '..', 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

function parseCli(argv) {
  const positionals = [];
  const values = new Map();
  const booleans = new Set();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      values.set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      values.set(token.slice(2), next);
      i += 1;
      continue;
    }
    booleans.add(token.slice(2));
  }

  let cmd = 'build';
  if (positionals[0] === 'build' || positionals[0] === 'plan') {
    cmd = positionals.shift();
  }

  return {
    cmd,
    projectDir: positionals[0] ?? '.',
    extraPositionals: positionals.slice(1),
    out: values.get('out'),
    target: values.get('target'),
    skipIsolint: booleans.has('skip-isolint'),
    dryRun: booleans.has('dry-run'),
  };
}

function printPlan(plan) {
  console.log(`iso: ${plan.projectDir}`);
  console.log(`  source: ${plan.hasAgentMd ? 'agent.md + iso/' : 'iso/'}`);
  console.log(`  out:    ${plan.outDir}`);
  console.log(`  steps:  ${plan.steps.length}`);
  for (const [idx, step] of plan.steps.entries()) {
    console.log(`    ${idx + 1}. ${step.label}`);
  }
}

const argv = process.argv.slice(2);
const requested = argv[0];
if (requested === '-h' || requested === '--help' || requested === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if (requested === '-v' || requested === '--version') {
  console.log(`iso ${readVersion()}`);
  process.exit(0);
}

const cli = parseCli(argv);
if (cli.extraPositionals.length) {
  console.error(`Unexpected argument(s): ${cli.extraPositionals.join(', ')}`);
  process.exit(2);
}

const opts = {
  out: cli.out,
  target: cli.target,
  skipIsolint: cli.skipIsolint,
  dryRun: cli.dryRun,
};

try {
  if (cli.cmd === 'plan') {
    printPlan(planPipeline(cli.projectDir, opts));
  } else {
    runPipeline(cli.projectDir, opts);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

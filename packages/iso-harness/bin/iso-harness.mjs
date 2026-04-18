#!/usr/bin/env node
import { build, validate } from '../src/build.mjs';
import { formatDiagnostic } from '../src/validate.mjs';
import { readFileSync, watch as fsWatch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, fallback) {
  // Support both `--flag value` and `--flag=value`.
  const eqPrefix = `--${name}=`;
  const eqIdx = args.findIndex((a) => a.startsWith(eqPrefix));
  if (eqIdx !== -1) return args[eqIdx].slice(eqPrefix.length);
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}

function boolFlag(name) {
  return args.includes(`--${name}`);
}

function list(name) {
  const v = flag(name);
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
}

const ALL_TARGETS = ['claude', 'cursor', 'codex', 'opencode'];

const USAGE = `iso-harness — one source directory, every agent harness

Usage:
  iso-harness --version
  iso-harness build    [--source <dir>] [--out <dir>] [--target claude,cursor,codex,opencode]
                       [--dry-run] [--watch]
  iso-harness validate [--source <dir>] [--format text|json]

Commands:
  build      Transpile iso/ source to one or more target harnesses.
             Runs validation first and refuses to write output if any
             source file has schema errors.
  validate   Schema-check the iso/ source without writing anything.
             Exit code: 0 if clean (warnings allowed), 1 if errors.

Flags:
  --source <dir>     Path to iso source directory (default: iso)
  --out <dir>        Output root directory (default: .)
  --target <list>    Comma-separated targets (default: all four)
  --dry-run          Print what would be written, with byte sizes. No disk writes.
  --watch            Rebuild on changes to the source directory. Ctrl-C to exit.
  --format <fmt>     validate-only: text (default) | json
`;

function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
  console.log(`iso-harness ${readVersion()}`);
  process.exit(0);
}

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  console.log(USAGE);
  process.exit(cmd ? 0 : 0);
}

async function runBuildOnce({ source, out, targets, dryRun }) {
  try {
    const summary = await build({ source, out, targets, dryRun });
    for (const line of summary) console.log(line);
    return 0;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

function watchBuild({ source, out, targets, dryRun }) {
  const sourceAbs = resolve(source);
  let scheduled = null;
  let building = false;
  const trigger = () => {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(async () => {
      scheduled = null;
      if (building) return;
      building = true;
      console.log(`\n--- change detected — rebuilding ---`);
      await runBuildOnce({ source, out, targets, dryRun });
      building = false;
    }, 150);
  };
  try {
    fsWatch(sourceAbs, { recursive: true }, trigger);
  } catch (err) {
    console.error(`watch failed for ${sourceAbs}: ${err.message}`);
    process.exit(1);
  }
  console.log(`watching ${sourceAbs} — press ^C to exit`);
}

if (cmd === 'build') {
  const source = flag('source', 'iso');
  const out = flag('out', '.');
  const targets = list('target') ?? ALL_TARGETS;
  const dryRun = boolFlag('dry-run');
  const watchMode = boolFlag('watch');
  const unknown = targets.filter(t => !ALL_TARGETS.includes(t));
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(', ')}. Valid: ${ALL_TARGETS.join(', ')}`);
    process.exit(2);
  }
  const initial = await runBuildOnce({ source, out, targets, dryRun });
  if (watchMode) {
    watchBuild({ source, out, targets, dryRun });
    // Keep the process alive; ^C exits.
  } else {
    process.exit(initial);
  }
} else if (cmd === 'validate') {
  const source = flag('source', 'iso');
  const format = flag('format', 'text');
  if (format !== 'text' && format !== 'json') {
    console.error(`Unknown --format value: ${format} (expected 'text' or 'json')`);
    process.exit(2);
  }
  let diagnostics;
  try {
    diagnostics = await validate({ source });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (format === 'json') {
    console.log(JSON.stringify(diagnostics, null, 2));
  } else {
    if (!diagnostics.length) {
      console.log(`iso-harness: ${source} is clean (0 diagnostics)`);
    } else {
      for (const d of diagnostics) console.log(formatDiagnostic(d));
      const errors = diagnostics.filter((d) => d.severity === 'error').length;
      const warnings = diagnostics.length - errors;
      console.log(`\n${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'})`);
    }
  }
  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
} else {
  console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
  process.exit(2);
}

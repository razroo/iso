#!/usr/bin/env node
import { build } from '../src/build.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}

function list(name) {
  const v = flag(name);
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
}

const ALL_TARGETS = ['claude', 'cursor', 'codex', 'opencode'];

if (cmd === 'build') {
  const source = flag('source', 'iso');
  const out = flag('out', '.');
  const targets = list('target') ?? ALL_TARGETS;
  const unknown = targets.filter(t => !ALL_TARGETS.includes(t));
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(', ')}. Valid: ${ALL_TARGETS.join(', ')}`);
    process.exit(2);
  }
  try {
    const summary = await build({ source, out, targets });
    for (const line of summary) console.log(line);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
} else {
  console.error(`Usage: iso-harness build [--source <dir>] [--out <dir>] [--target claude,cursor,codex,opencode]

Commands:
  build    Transpile iso/ source to one or more target harnesses.

Flags:
  --source <dir>   Path to iso source directory (default: iso)
  --out <dir>      Output root directory (default: .)
  --target <list>  Comma-separated targets (default: all four)
`);
  process.exit(cmd ? 2 : 0);
}

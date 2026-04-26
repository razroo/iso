#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatConfigSummary,
  formatMigrationResult,
  loadMigrationConfig,
  parseJson,
  runMigrations,
} from "./index.js";
import type { MigrationConfig } from "./types.js";

const USAGE = `iso-migrate - deterministic project migrations for agent workflows

usage:
  iso-migrate --version | -v
  iso-migrate --help | -h
  iso-migrate plan --config <file> [--root <dir>] [--json]
  iso-migrate apply --config <file> [--root <dir>] [--json]
  iso-migrate check --config <file> [--root <dir>] [--json]
  iso-migrate explain --config <file> [--json]

plan is a dry run. check exits 1 when changes are pending.
`;

interface CommonOptions {
  config: string;
  root: string;
  json: boolean;
  help: boolean;
}

export function main(argv = process.argv.slice(2)): number {
  try {
    const [cmd, ...args] = argv;
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
      console.log(USAGE);
      return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
      console.log(readVersion());
      return 0;
    }
    if (cmd === "plan") return cmdRun(args, "plan");
    if (cmd === "apply") return cmdRun(args, "apply");
    if (cmd === "check") return cmdRun(args, "check");
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-migrate: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-migrate: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdRun(args: string[], mode: "plan" | "apply" | "check"): number {
  const opts = parseCommon(args);
  const result = runMigrations(readConfig(opts.config), {
    root: opts.root,
    dryRun: mode !== "apply",
  });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatMigrationResult(result, mode));
  return mode === "check" && result.changed ? 1 : 0;
}

function cmdExplain(args: string[]): number {
  const opts = parseCommon(args);
  const config = readConfig(opts.config);
  if (opts.json) console.log(JSON.stringify(config, null, 2));
  else console.log(formatConfigSummary(config));
  return 0;
}

function parseCommon(args: string[]): CommonOptions {
  const opts: CommonOptions = { config: "", root: ".", json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") opts.config = requiredValue(args, ++i, "--config");
    else if (arg.startsWith("--config=")) opts.config = arg.slice("--config=".length);
    else if (arg === "--root") opts.root = requiredValue(args, ++i, "--root");
    else if (arg.startsWith("--root=")) opts.root = arg.slice("--root=".length);
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`unknown flag "${arg}"`);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!opts.config) throw new Error("--config is required");
  return opts;
}

function readConfig(path: string): MigrationConfig {
  return loadMigrationConfig(parseJson(readFileSync(resolve(path), "utf8"), path));
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function isDirectCliInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isDirectCliInvocation()) {
  process.exit(main());
}

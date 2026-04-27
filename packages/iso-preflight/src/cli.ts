#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatConfigSummary,
  formatPreflightPlan,
  loadPreflightConfig,
  parseJson,
  planPreflight,
} from "./index.js";
import type { JsonValue, PreflightConfig } from "./types.js";

const USAGE = `iso-preflight - deterministic preflight planning for agent workflows

usage:
  iso-preflight --version | -v
  iso-preflight --help | -h
  iso-preflight plan --config <file> --candidates <file> [--workflow <name>] [--json]
  iso-preflight check --config <file> --candidates <file> [--workflow <name>] [--json]
  iso-preflight explain --config <file> [--json]

check exits 1 when candidates are blocked.
`;

interface RunOptions {
  config: string;
  candidates: string;
  workflow?: string;
  json: boolean;
  help: boolean;
}

interface ExplainOptions {
  config: string;
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
    if (cmd === "check") return cmdRun(args, "check");
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-preflight: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-preflight: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdRun(args: string[], mode: "plan" | "check"): number {
  const opts = parseRun(args);
  const result = planPreflight(readConfig(opts.config), readJsonFile(opts.candidates), {
    workflow: opts.workflow,
  });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatPreflightPlan(result, mode));
  return mode === "check" && !result.ok ? 1 : 0;
}

function cmdExplain(args: string[]): number {
  const opts = parseExplain(args);
  const config = readConfig(opts.config);
  if (opts.json) console.log(JSON.stringify(config, null, 2));
  else console.log(formatConfigSummary(config));
  return 0;
}

function parseRun(args: string[]): RunOptions {
  const opts: RunOptions = { config: "", candidates: "", json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") opts.config = requiredValue(args, ++i, "--config");
    else if (arg.startsWith("--config=")) opts.config = arg.slice("--config=".length);
    else if (arg === "--candidates") opts.candidates = requiredValue(args, ++i, "--candidates");
    else if (arg.startsWith("--candidates=")) opts.candidates = arg.slice("--candidates=".length);
    else if (arg === "--workflow") opts.workflow = requiredValue(args, ++i, "--workflow");
    else if (arg.startsWith("--workflow=")) opts.workflow = arg.slice("--workflow=".length);
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`unknown flag "${arg}"`);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!opts.config) throw new Error("--config is required");
  if (!opts.candidates) throw new Error("--candidates is required");
  return opts;
}

function parseExplain(args: string[]): ExplainOptions {
  const opts: ExplainOptions = { config: "", json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") opts.config = requiredValue(args, ++i, "--config");
    else if (arg.startsWith("--config=")) opts.config = arg.slice("--config=".length);
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

function readConfig(path: string): PreflightConfig {
  return loadPreflightConfig(readJsonFile(path));
}

function readJsonFile(path: string): JsonValue {
  return parseJson(readFileSync(resolve(path), "utf8"), path);
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

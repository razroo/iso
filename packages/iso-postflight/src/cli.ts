#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatConfigSummary,
  formatPostflightResult,
  loadPostflightConfig,
  parseJson,
  settlePostflight,
} from "./index.js";
import type { JsonValue, PostflightConfig } from "./types.js";

const USAGE = `iso-postflight - deterministic postflight settlement for agent workflows

usage:
  iso-postflight --version | -v
  iso-postflight --help | -h
  iso-postflight status --config <file> --plan <file> --outcomes <file> [--workflow <name>] [--json]
  iso-postflight check  --config <file> --plan <file> --outcomes <file> [--workflow <name>] [--json]
  iso-postflight explain --config <file> [--json]

check exits 1 unless the workflow is complete.
`;

interface RunOptions {
  config: string;
  plan: string;
  outcomes: string;
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
    if (cmd === "status") return cmdRun(args, "status");
    if (cmd === "check") return cmdRun(args, "check");
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-postflight: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-postflight: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdRun(args: string[], mode: "status" | "check"): number {
  const opts = parseRun(args);
  const result = settlePostflight(
    readConfig(opts.config),
    readJsonFile(opts.plan),
    readJsonFile(opts.outcomes),
    { workflow: opts.workflow },
  );
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatPostflightResult(result, mode));
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
  const opts: RunOptions = { config: "", plan: "", outcomes: "", json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") opts.config = requiredValue(args, ++i, "--config");
    else if (arg.startsWith("--config=")) opts.config = arg.slice("--config=".length);
    else if (arg === "--plan") opts.plan = requiredValue(args, ++i, "--plan");
    else if (arg.startsWith("--plan=")) opts.plan = arg.slice("--plan=".length);
    else if (arg === "--outcomes") opts.outcomes = requiredValue(args, ++i, "--outcomes");
    else if (arg.startsWith("--outcomes=")) opts.outcomes = arg.slice("--outcomes=".length);
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
  if (!opts.plan) throw new Error("--plan is required");
  if (!opts.outcomes) throw new Error("--outcomes is required");
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

function readConfig(path: string): PostflightConfig {
  return loadPostflightConfig(readJsonFile(path));
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

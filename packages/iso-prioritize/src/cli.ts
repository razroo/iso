#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPrioritize,
  formatCheckResult,
  formatConfigSummary,
  formatPrioritizeResult,
  formatVerifyResult,
  loadPrioritizeConfig,
  parseJson,
  prioritize,
  selectPrioritized,
  verifyPrioritizeResult,
} from "./index.js";
import type { PrioritizeConfig, PrioritizedItemState } from "./types.js";

const USAGE = `iso-prioritize - deterministic policy-based queue prioritization for agent workflows

usage:
  iso-prioritize --version | -v
  iso-prioritize --help | -h
  iso-prioritize rank --config <file> --items <file> [--profile <name>] [--limit N] [--out <file>] [--json]
  iso-prioritize select --config <file> --items <file> [--profile <name>] [--limit N] [--out <file>] [--json]
  iso-prioritize check --config <file> --items <file> [--profile <name>] [--limit N] [--min-selected N] [--fail-on blocked|skipped|none] [--json]
  iso-prioritize verify --result <file> [--json]
  iso-prioritize explain --config <file> [--profile <name>] [--json]

Items may be a JSON array or {"items":[...]}.
`;

interface CommonOptions {
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
    if (cmd === "rank") return cmdRank(args, false);
    if (cmd === "select") return cmdRank(args, true);
    if (cmd === "check") return cmdCheck(args);
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-prioritize: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-prioritize: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdRank(args: string[], selectedOnly: boolean): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let itemsPath = "";
  let profile = "";
  let limit: number | undefined;
  let out = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--items") itemsPath = requiredValue(rest, ++i, "--items");
    else if (arg.startsWith("--items=")) itemsPath = arg.slice("--items=".length);
    else if (arg === "--profile") profile = requiredValue(rest, ++i, "--profile");
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
    else if (arg === "--limit") limit = parsePositiveInteger(requiredValue(rest, ++i, "--limit"), "--limit");
    else if (arg.startsWith("--limit=")) limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
    else if (arg === "--out") out = requiredValue(rest, ++i, "--out");
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else return usageError(`${selectedOnly ? "select" : "rank"}: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError(`${selectedOnly ? "select" : "rank"}: --config is required`);
  if (!itemsPath) return usageError(`${selectedOnly ? "select" : "rank"}: --items is required`);
  const result = selectedOnly
    ? selectPrioritized(prioritize(readConfig(configPath), readJson(itemsPath), { profile: profile || undefined, limit }))
    : prioritize(readConfig(configPath), readJson(itemsPath), { profile: profile || undefined, limit });
  if (out) writeFileSync(resolve(out), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatPrioritizeResult(result));
  return 0;
}

function cmdCheck(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let itemsPath = "";
  let profile = "";
  let limit: number | undefined;
  let minSelected: number | undefined;
  let failOn: PrioritizedItemState[] | "none" | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--items") itemsPath = requiredValue(rest, ++i, "--items");
    else if (arg.startsWith("--items=")) itemsPath = arg.slice("--items=".length);
    else if (arg === "--profile") profile = requiredValue(rest, ++i, "--profile");
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
    else if (arg === "--limit") limit = parsePositiveInteger(requiredValue(rest, ++i, "--limit"), "--limit");
    else if (arg.startsWith("--limit=")) limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
    else if (arg === "--min-selected") minSelected = parseNonNegativeInteger(requiredValue(rest, ++i, "--min-selected"), "--min-selected");
    else if (arg.startsWith("--min-selected=")) minSelected = parseNonNegativeInteger(arg.slice("--min-selected=".length), "--min-selected");
    else if (arg === "--fail-on") failOn = parseFailOn(requiredValue(rest, ++i, "--fail-on"));
    else if (arg.startsWith("--fail-on=")) failOn = parseFailOn(arg.slice("--fail-on=".length));
    else return usageError(`check: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("check: --config is required");
  if (!itemsPath) return usageError("check: --items is required");
  const result = checkPrioritize(readConfig(configPath), readJson(itemsPath), {
    profile: profile || undefined,
    limit,
    minSelected,
    failOn,
  });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheckResult(result));
  return result.ok ? 0 : 1;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let resultPath = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--result") resultPath = requiredValue(rest, ++i, "--result");
    else if (arg.startsWith("--result=")) resultPath = arg.slice("--result=".length);
    else return usageError(`verify: unknown flag "${arg}"`);
  }
  if (!resultPath) return usageError("verify: --result is required");
  const result = verifyPrioritizeResult(readJson(resultPath));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
  return result.ok ? 0 : 1;
}

function cmdExplain(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let profile = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--profile") profile = requiredValue(rest, ++i, "--profile");
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
    else return usageError(`explain: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("explain: --config is required");
  const config = readConfig(configPath);
  if (opts.json) console.log(JSON.stringify(config, null, 2));
  else console.log(formatConfigSummary(config, profile || undefined));
  return 0;
}

function parseCommon(args: string[]): { opts: CommonOptions; rest: string[] } {
  const opts: CommonOptions = { json: false, help: false };
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else rest.push(arg);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  return { opts, rest };
}

function parseFailOn(input: string): PrioritizedItemState[] | "none" {
  if (input === "none") return "none";
  return input.split(",").map((item) => {
    const value = item.trim();
    if (!isPrioritizedItemState(value)) throw new Error(`unknown --fail-on state "${value}"`);
    return value;
  });
}

function isPrioritizedItemState(value: string): value is PrioritizedItemState {
  return value === "selected" || value === "candidate" || value === "skipped" || value === "blocked";
}

function readConfig(path: string): PrioritizeConfig {
  return loadPrioritizeConfig(readJson(path));
}

function readJson(path: string): unknown {
  return parseJson(readFileSync(resolve(path), "utf8"), path);
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function usageError(message: string): number {
  console.error(`iso-prioritize: ${message}`);
  return 2;
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

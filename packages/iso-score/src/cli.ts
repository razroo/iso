#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkScore,
  compareScoreResults,
  computeScore,
  evaluateGate,
  formatCheckResult,
  formatComparison,
  formatConfigSummary,
  formatGateResult,
  formatScoreResult,
  formatVerifyResult,
  loadScoreConfig,
  parseJson,
  verifyScoreResult,
} from "./index.js";
import type { ScoreConfig, ScoreInput, ScoreResult } from "./types.js";

const USAGE = `iso-score - deterministic weighted rubric scoring for agent workflows

usage:
  iso-score --version | -v
  iso-score --help | -h
  iso-score compute --config <file> --input <file> [--profile <name>] [--out <file>] [--json]
  iso-score verify --score <file> [--json]
  iso-score check --config <file> --input <file> [--profile <name>] [--json]
  iso-score gate --config <file> --input <file> [--profile <name>] [--gate <id>] [--json]
  iso-score compare --config <file> --left <file> --right <file> [--profile <name>] [--json]
  iso-score explain --config <file> [--profile <name>] [--json]
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
    if (cmd === "compute") return cmdCompute(args);
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "check") return cmdCheck(args);
    if (cmd === "gate") return cmdGate(args);
    if (cmd === "compare") return cmdCompare(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-score: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-score: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdCompute(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let inputPath = "";
  let profile = "";
  let out = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--input") inputPath = requiredValue(rest, ++i, "--input");
    else if (arg.startsWith("--input=")) inputPath = arg.slice("--input=".length);
    else if (arg === "--profile") profile = requiredValue(rest, ++i, "--profile");
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
    else if (arg === "--out") out = requiredValue(rest, ++i, "--out");
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else return usageError(`compute: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("compute: --config is required");
  if (!inputPath) return usageError("compute: --input is required");
  const result = computeScore(readConfig(configPath), readInput(inputPath), { profile: profile || undefined });
  if (out) writeFileSync(resolve(out), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatScoreResult(result));
  return 0;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let scorePath = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--score") scorePath = requiredValue(rest, ++i, "--score");
    else if (arg.startsWith("--score=")) scorePath = arg.slice("--score=".length);
    else return usageError(`verify: unknown flag "${arg}"`);
  }
  if (!scorePath) return usageError("verify: --score is required");
  const result = verifyScoreResult(readScore(scorePath));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
  return result.ok ? 0 : 1;
}

function cmdCheck(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const parsed = parseConfigInputProfile(rest, "check");
  if (!parsed.ok) return parsed.code;
  const result = checkScore(readConfig(parsed.configPath), readInput(parsed.inputPath), { profile: parsed.profile || undefined });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheckResult(result));
  return result.ok ? 0 : 1;
}

function cmdGate(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let gate = "";
  const filtered: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--gate") gate = requiredValue(rest, ++i, "--gate");
    else if (arg.startsWith("--gate=")) gate = arg.slice("--gate=".length);
    else filtered.push(arg);
  }
  const parsed = parseConfigInputProfile(filtered, "gate");
  if (!parsed.ok) return parsed.code;
  const result = evaluateGate(readConfig(parsed.configPath), readInput(parsed.inputPath), {
    profile: parsed.profile || undefined,
    gate: gate || undefined,
  });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatGateResult(result));
  return result.ok ? 0 : 1;
}

function cmdCompare(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let leftPath = "";
  let rightPath = "";
  let profile = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--left") leftPath = requiredValue(rest, ++i, "--left");
    else if (arg.startsWith("--left=")) leftPath = arg.slice("--left=".length);
    else if (arg === "--right") rightPath = requiredValue(rest, ++i, "--right");
    else if (arg.startsWith("--right=")) rightPath = arg.slice("--right=".length);
    else if (arg === "--profile") profile = requiredValue(rest, ++i, "--profile");
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
    else return usageError(`compare: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("compare: --config is required");
  if (!leftPath) return usageError("compare: --left is required");
  if (!rightPath) return usageError("compare: --right is required");
  const config = readConfig(configPath);
  const comparison = compareScoreResults(
    computeScore(config, readInput(leftPath), { profile: profile || undefined }),
    computeScore(config, readInput(rightPath), { profile: profile || undefined }),
  );
  if (opts.json) console.log(JSON.stringify(comparison, null, 2));
  else console.log(formatComparison(comparison));
  const hasErrors = [...comparison.left.issues, ...comparison.right.issues].some((issue) => issue.severity === "error");
  return hasErrors ? 1 : 0;
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
  if (opts.json) {
    const value = profile ? { ...config, profiles: config.profiles.filter((candidate) => candidate.name === profile) } : config;
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(formatConfigSummary(config, profile || undefined));
  }
  return 0;
}

function parseCommon(args: string[]): { opts: CommonOptions; rest: string[] } {
  const opts: CommonOptions = { json: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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

function parseConfigInputProfile(rest: string[], command: string):
  | { ok: true; configPath: string; inputPath: string; profile: string }
  | { ok: false; code: number } {
  let configPath = "";
  let inputPath = "";
  let profile = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--input") inputPath = requiredValue(rest, ++i, "--input");
    else if (arg.startsWith("--input=")) inputPath = arg.slice("--input=".length);
    else if (arg === "--profile") profile = requiredValue(rest, ++i, "--profile");
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
    else return { ok: false, code: usageError(`${command}: unknown flag "${arg}"`) };
  }
  if (!configPath) return { ok: false, code: usageError(`${command}: --config is required`) };
  if (!inputPath) return { ok: false, code: usageError(`${command}: --input is required`) };
  return { ok: true, configPath, inputPath, profile };
}

function readConfig(path: string): ScoreConfig {
  return loadScoreConfig(parseJson(readFileSync(resolve(path), "utf8"), path));
}

function readInput(path: string): ScoreInput {
  return parseJson(readFileSync(resolve(path), "utf8"), path) as unknown as ScoreInput;
}

function readScore(path: string): ScoreResult {
  return parseJson(readFileSync(resolve(path), "utf8"), path) as unknown as ScoreResult;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usageError(message: string): number {
  console.error(`iso-score: ${message}`);
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

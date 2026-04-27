#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_FACTS_FILE,
  buildFacts,
  checkFactRequirements,
  formatBuildResult,
  formatCheckResult,
  formatConfigSummary,
  formatFacts,
  formatVerifyResult,
  hasFact,
  loadFactsConfig,
  parseJson,
  queryFacts,
  verifyFactSet,
} from "./index.js";
import type { FactConfig, FactQueryOptions, FactSet } from "./types.js";

const USAGE = `iso-facts - deterministic fact materialization for agent workflows

usage:
  iso-facts --version | -v
  iso-facts --help | -h
  iso-facts build --config <file> [--root <dir>] [--out <file>] [--json]
  iso-facts query [text] [--facts <file>] [--fact <fact>] [--key <key>] [--value <value>] [--source <path>] [--tag <tag>] [--limit N] [--json]
  iso-facts has [text] [--facts <file>] [--fact <fact>] [--key <key>] [--value <value>] [--source <path>] [--tag <tag>] [--json]
  iso-facts verify [--facts <file>] [--json]
  iso-facts check --config <file> [--facts <file>] [--json]
  iso-facts explain --config <file> [--json]

Default fact-set path: .iso-facts.json under the current directory.
`;

interface CommonOptions {
  facts: string;
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
    if (cmd === "build") return cmdBuild(args);
    if (cmd === "query") return cmdQuery(args, false);
    if (cmd === "has") return cmdQuery(args, true);
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "check") return cmdCheck(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-facts: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-facts: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdBuild(args: string[]): number {
  let configPath = "";
  let root = ".";
  let out = DEFAULT_FACTS_FILE;
  const { opts, rest } = parseCommon(args);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--root") root = requiredValue(rest, ++i, "--root");
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else if (arg === "--out") out = requiredValue(rest, ++i, "--out");
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else return usageError(`build: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("build: --config is required");
  const factSet = buildFacts(readConfig(configPath), { root });
  writeFileSync(resolve(out), `${JSON.stringify(factSet, null, 2)}\n`, "utf8");
  if (opts.json) console.log(JSON.stringify({ out: resolve(out), stats: factSet.stats }, null, 2));
  else console.log(formatBuildResult(factSet, resolve(out)));
  return 0;
}

function cmdQuery(args: string[], asHas: boolean): number {
  const { opts, rest } = parseCommon(args);
  const query: FactQueryOptions = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--fact") query.fact = requiredValue(rest, ++i, "--fact");
    else if (arg.startsWith("--fact=")) query.fact = arg.slice("--fact=".length);
    else if (arg === "--key") query.key = requiredValue(rest, ++i, "--key");
    else if (arg.startsWith("--key=")) query.key = arg.slice("--key=".length);
    else if (arg === "--value") query.value = requiredValue(rest, ++i, "--value");
    else if (arg.startsWith("--value=")) query.value = arg.slice("--value=".length);
    else if (arg === "--source") query.source = requiredValue(rest, ++i, "--source");
    else if (arg.startsWith("--source=")) query.source = arg.slice("--source=".length);
    else if (arg === "--tag") query.tag = requiredValue(rest, ++i, "--tag");
    else if (arg.startsWith("--tag=")) query.tag = arg.slice("--tag=".length);
    else if (arg === "--limit") query.limit = parsePositiveInteger(requiredValue(rest, ++i, "--limit"), "--limit");
    else if (arg.startsWith("--limit=")) query.limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
    else if (arg.startsWith("--")) return usageError(`${asHas ? "has" : "query"}: unknown flag "${arg}"`);
    else positional.push(arg);
  }
  if (positional.length) query.text = positional.join(" ");
  const factSet = readFacts(opts.facts);
  if (asHas) {
    const hit = hasFact(factSet, query);
    if (opts.json) console.log(JSON.stringify({ hit }, null, 2));
    else console.log(hit ? "iso-facts: MATCH" : "iso-facts: MISS");
    return hit ? 0 : 1;
  }
  const facts = queryFacts(factSet, query);
  if (opts.json) console.log(JSON.stringify(facts, null, 2));
  else console.log(formatFacts(facts));
  return 0;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  if (rest.length) return usageError(`verify: unknown argument "${rest[0]}"`);
  const result = verifyFactSet(readFacts(opts.facts));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
  return result.ok ? 0 : 1;
}

function cmdCheck(args: string[]): number {
  let configPath = "";
  const { opts, rest } = parseCommon(args);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else return usageError(`check: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("check: --config is required");
  const config = readConfig(configPath);
  const result = checkFactRequirements(readFacts(opts.facts), config.requirements || []);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheckResult(result));
  return result.ok ? 0 : 1;
}

function cmdExplain(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else return usageError(`explain: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("explain: --config is required");
  const config = readConfig(configPath);
  if (opts.json) console.log(JSON.stringify(config, null, 2));
  else console.log(formatConfigSummary(config));
  return 0;
}

function parseCommon(args: string[]): { opts: CommonOptions; rest: string[] } {
  const opts: CommonOptions = { facts: DEFAULT_FACTS_FILE, json: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--facts") opts.facts = requiredValue(args, ++i, "--facts");
    else if (arg.startsWith("--facts=")) opts.facts = arg.slice("--facts=".length);
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else rest.push(arg);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  return { opts, rest };
}

function readConfig(path: string): FactConfig {
  return loadFactsConfig(parseJson(readFileSync(resolve(path), "utf8"), path));
}

function readFacts(path: string): FactSet {
  return parseJson(readFileSync(resolve(path), "utf8"), path) as unknown as FactSet;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function usageError(message: string): number {
  console.error(`iso-facts: ${message}`);
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

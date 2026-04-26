#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_INDEX_FILE,
  buildIndex,
  formatBuildResult,
  formatConfigSummary,
  formatIndexRecords,
  formatVerifyResult,
  hasIndexRecord,
  loadIndexConfig,
  parseJson,
  queryIndex,
  verifyIndex,
} from "./index.js";
import type { ArtifactIndex, IndexConfig, IndexQueryOptions } from "./types.js";

const USAGE = `iso-index - deterministic local artifact index for agent workflows

usage:
  iso-index --version | -v
  iso-index --help | -h
  iso-index build --config <file> [--root <dir>] [--out <file>] [--json]
  iso-index query [text] [--index <file>] [--kind <kind>] [--key <key>] [--value <value>] [--source <path>] [--limit N] [--json]
  iso-index has [text] [--index <file>] [--kind <kind>] [--key <key>] [--value <value>] [--source <path>] [--json]
  iso-index verify [--index <file>] [--json]
  iso-index explain --config <file> [--json]

Default index path: .iso-index.json under the current directory.
`;

interface CommonOptions {
  index: string;
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
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-index: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-index: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function cmdBuild(args: string[]): number {
  let configPath = "";
  let root = ".";
  let out = DEFAULT_INDEX_FILE;
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
  const config = readConfig(configPath);
  const index = buildIndex(config, { root });
  writeFileSync(resolve(out), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  if (opts.json) console.log(JSON.stringify({ out: resolve(out), stats: index.stats }, null, 2));
  else console.log(formatBuildResult(index, resolve(out)));
  return 0;
}

function cmdQuery(args: string[], asHas: boolean): number {
  const { opts, rest } = parseCommon(args);
  const query: IndexQueryOptions = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--kind") query.kind = requiredValue(rest, ++i, "--kind");
    else if (arg.startsWith("--kind=")) query.kind = arg.slice("--kind=".length);
    else if (arg === "--key") query.key = requiredValue(rest, ++i, "--key");
    else if (arg.startsWith("--key=")) query.key = arg.slice("--key=".length);
    else if (arg === "--value") query.value = requiredValue(rest, ++i, "--value");
    else if (arg.startsWith("--value=")) query.value = arg.slice("--value=".length);
    else if (arg === "--source") query.source = requiredValue(rest, ++i, "--source");
    else if (arg.startsWith("--source=")) query.source = arg.slice("--source=".length);
    else if (arg === "--limit") query.limit = parsePositiveInteger(requiredValue(rest, ++i, "--limit"), "--limit");
    else if (arg.startsWith("--limit=")) query.limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
    else if (arg.startsWith("--")) return usageError(`${asHas ? "has" : "query"}: unknown flag "${arg}"`);
    else positional.push(arg);
  }
  if (positional.length) query.text = positional.join(" ");
  const index = readIndex(opts.index);
  if (asHas) {
    const hit = hasIndexRecord(index, query);
    if (opts.json) console.log(JSON.stringify({ hit }, null, 2));
    else console.log(hit ? "iso-index: MATCH" : "iso-index: MISS");
    return hit ? 0 : 1;
  }
  const records = queryIndex(index, query);
  if (opts.json) console.log(JSON.stringify(records, null, 2));
  else console.log(formatIndexRecords(records));
  return 0;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  if (rest.length) return usageError(`verify: unknown argument "${rest[0]}"`);
  const result = verifyIndex(readIndex(opts.index));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
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
  const opts: CommonOptions = { index: DEFAULT_INDEX_FILE, json: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--index") opts.index = requiredValue(args, ++i, "--index");
    else if (arg.startsWith("--index=")) opts.index = arg.slice("--index=".length);
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

function readConfig(path: string): IndexConfig {
  return loadIndexConfig(parseJson(readFileSync(resolve(path), "utf8"), path));
}

function readIndex(path: string): ArtifactIndex {
  return parseJson(readFileSync(resolve(path), "utf8"), path) as unknown as ArtifactIndex;
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
  console.error(`iso-index: ${message}`);
  return 2;
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

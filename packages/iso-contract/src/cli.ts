#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contractNames,
  explainContract,
  formatValidationResult,
  getContract,
  loadContractCatalog,
  parseJson,
  parseJsonObject,
  parseRecord,
  recordFromJsonObject,
  renderRecord,
  validateRecord,
} from "./index.js";
import type { ContractCatalog, ContractInput, ContractRecord, JsonObject } from "./types.js";

const USAGE = `iso-contract — deterministic artifact contracts for agent workflows

usage:
  iso-contract --version | -v
  iso-contract --help | -h
  iso-contract list --contracts <contracts.json> [--json]
  iso-contract explain <contract> --contracts <contracts.json> [--json]
  iso-contract validate <contract> --contracts <contracts.json> [--input <json|@file|->] [--format json|tsv|markdown] [--json]
  iso-contract parse <contract> --contracts <contracts.json> --format <name> [--input <line|@file|->] [--json]
  iso-contract render <contract> --contracts <contracts.json> --format <name> [--input <json|@file|->] [--json]

Contracts are JSON files containing either { "contracts": [...] }, one contract,
or an array of contracts.
`;

interface CliOptions {
  contracts?: string;
  input?: string;
  format: string;
  json: boolean;
  help: boolean;
}

export function main(argv = process.argv.slice(2)): number {
  try {
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
      console.log(USAGE);
      return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
      console.log(readVersion());
      return 0;
    }

    const { positional, opts } = parseArgs(rest);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }

    if (cmd === "list") return listContracts(opts);
    if (cmd === "explain") return explain(positional, opts);
    if (cmd === "validate") return validate(positional, opts);
    if (cmd === "parse") return parse(positional, opts);
    if (cmd === "render") return render(positional, opts);

    console.error(`unknown command "${cmd}"\n`);
    console.error(USAGE);
    return 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function parseArgs(args: string[]): { positional: string[]; opts: CliOptions } {
  const positional: string[] = [];
  const opts: CliOptions = { format: "json", json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--contracts") {
      opts.contracts = valueAfter(args, ++i, "--contracts");
    } else if (arg.startsWith("--contracts=")) {
      opts.contracts = arg.slice("--contracts=".length);
    } else if (arg === "--input") {
      opts.input = valueAfter(args, ++i, "--input");
    } else if (arg.startsWith("--input=")) {
      opts.input = arg.slice("--input=".length);
    } else if (arg === "--format") {
      opts.format = valueAfter(args, ++i, "--format");
    } else if (arg.startsWith("--format=")) {
      opts.format = arg.slice("--format=".length);
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag "${arg}"`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function listContracts(opts: CliOptions): number {
  const catalog = readCatalog(opts);
  const names = contractNames(catalog);
  if (opts.json) console.log(JSON.stringify(names, null, 2));
  else console.log(names.join("\n"));
  return 0;
}

function explain(positional: string[], opts: CliOptions): number {
  const contract = readContract(positional, opts);
  if (opts.json) console.log(JSON.stringify(contract, null, 2));
  else console.log(explainContract(contract));
  return 0;
}

function validate(positional: string[], opts: CliOptions): number {
  const contract = readContract(positional, opts);
  const input = readInput(opts.input);
  const result = opts.format === "json"
    ? validateRecord(contract, jsonRecord(input))
    : parseRecord(contract, input, opts.format).validation;

  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatValidationResult(contract, result));
  return result.errors > 0 ? 1 : 0;
}

function parse(positional: string[], opts: CliOptions): number {
  const contract = readContract(positional, opts);
  if (opts.format === "json") throw new Error("parse requires a non-json --format");
  const result = parseRecord(contract, readInput(opts.input), opts.format);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(JSON.stringify(result.record, null, 2));
  return result.validation.errors > 0 ? 1 : 0;
}

function render(positional: string[], opts: CliOptions): number {
  const contract = readContract(positional, opts);
  const result = renderRecord(contract, jsonRecord(readInput(opts.input)), opts.format);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(result.text);
  return result.validation.errors > 0 ? 1 : 0;
}

function readContract(positional: string[], opts: CliOptions) {
  const name = positional[0];
  if (!name) throw new Error("missing contract name");
  return getContract(readCatalog(opts), name);
}

function readCatalog(opts: CliOptions): ContractCatalog {
  if (!opts.contracts) throw new Error("missing --contracts <contracts.json>");
  const raw = readFileSync(resolve(opts.contracts), "utf8");
  return loadContractCatalog(parseJson(raw, opts.contracts) as unknown as ContractInput);
}

function readInput(input: string | undefined): string {
  if (!input || input === "-") return readFileSync(0, "utf8");
  if (input.startsWith("@")) return readFileSync(resolve(input.slice(1)), "utf8");
  return input;
}

function jsonRecord(raw: string): ContractRecord {
  const parsed = parseJsonObject(raw, "--input");
  return recordFromJsonObject(parsed as JsonObject);
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

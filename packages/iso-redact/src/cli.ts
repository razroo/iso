#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatConfigSummary,
  formatScanResult,
  loadRedactConfig,
  parseJson,
  redactText,
  scanSources,
} from "./index.js";
import type { JsonValue, RedactConfig, RedactSource } from "./types.js";

const USAGE = `iso-redact - deterministic local redaction for agent workflows

usage:
  iso-redact --version | -v
  iso-redact --help | -h
  iso-redact scan   --config <file> [--input <file> ...] [--stdin] [--json]
  iso-redact verify --config <file> [--input <file> ...] [--stdin] [--json]
  iso-redact apply  --config <file> (--input <file> | --stdin) [--output <file>] [--json]
  iso-redact explain --config <file> [--json]

verify exits 1 when sensitive values are still present.
apply writes redacted text to --output or stdout.
`;

interface ScanOptions {
  config: string;
  inputs: string[];
  stdin: boolean;
  json: boolean;
  help: boolean;
}

interface ApplyOptions extends ScanOptions {
  output?: string;
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
    if (cmd === "scan") return cmdScan(args, "scan");
    if (cmd === "verify") return cmdScan(args, "verify");
    if (cmd === "apply") return cmdApply(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-redact: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-redact: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdScan(args: string[], mode: "scan" | "verify"): number {
  const opts = parseScan(args);
  const result = scanSources(readConfig(opts.config), readSources(opts));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatScanResult(result, mode));
  return mode === "verify" && !result.ok ? 1 : 0;
}

function cmdApply(args: string[]): number {
  const opts = parseApply(args);
  const sources = readSources(opts);
  if (sources.length !== 1) throw new Error("apply requires exactly one --input or --stdin source");
  const result = redactText(readConfig(opts.config), sources[0]?.text ?? "", { source: sources[0]?.name });
  if (opts.output) {
    writeFileSync(resolve(opts.output), result.text);
    if (opts.json) console.log(JSON.stringify({ ...result, text: undefined }, null, 2));
    else console.log(`iso-redact: wrote ${opts.output} (${result.findings.length} finding(s) redacted)`);
  } else if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.text);
  }
  return 0;
}

function cmdExplain(args: string[]): number {
  const opts = parseExplain(args);
  const config = readConfig(opts.config);
  if (opts.json) console.log(JSON.stringify(config, null, 2));
  else console.log(formatConfigSummary(config));
  return 0;
}

function parseScan(args: string[]): ScanOptions {
  const opts: ScanOptions = { config: "", inputs: [], stdin: false, json: false, help: false };
  parseCommon(args, opts);
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!opts.config) throw new Error("--config is required");
  if (!opts.stdin && !opts.inputs.length) throw new Error("at least one --input or --stdin source is required");
  return opts;
}

function parseApply(args: string[]): ApplyOptions {
  const opts: ApplyOptions = { config: "", inputs: [], stdin: false, json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--output" || arg === "-o") opts.output = requiredValue(args, ++i, arg);
    else if (arg.startsWith("--output=")) opts.output = arg.slice("--output=".length);
    else i = parseCommonFlag(args, i, opts);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!opts.config) throw new Error("--config is required");
  if ((opts.stdin ? 1 : 0) + opts.inputs.length !== 1) throw new Error("apply requires exactly one --input or --stdin source");
  return opts;
}

function parseExplain(args: string[]): ExplainOptions {
  const opts: ExplainOptions = { config: "", json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") opts.config = requiredValue(args, ++i, arg);
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

function parseCommon(args: string[], opts: ScanOptions): void {
  for (let i = 0; i < args.length; i++) i = parseCommonFlag(args, i, opts);
}

function parseCommonFlag(args: string[], index: number, opts: ScanOptions): number {
  const arg = args[index];
  if (arg === "--config" || arg === "-c") opts.config = requiredValue(args, index + 1, arg);
  else if (arg.startsWith("--config=")) opts.config = arg.slice("--config=".length);
  else if (arg === "--input" || arg === "-i") opts.inputs.push(requiredValue(args, index + 1, arg));
  else if (arg.startsWith("--input=")) opts.inputs.push(arg.slice("--input=".length));
  else if (arg === "--stdin") opts.stdin = true;
  else if (arg === "--json") opts.json = true;
  else if (arg === "--help" || arg === "-h") opts.help = true;
  else if (!arg.startsWith("-")) opts.inputs.push(arg);
  else throw new Error(`unknown flag "${arg}"`);
  return (arg === "--config" || arg === "-c" || arg === "--input" || arg === "-i") ? index + 1 : index;
}

function readSources(opts: ScanOptions): RedactSource[] {
  const sources = opts.inputs.map((input) => ({
    name: input,
    text: readFileSync(resolve(input), "utf8"),
  }));
  if (opts.stdin) sources.push({ name: "<stdin>", text: readFileSync(0, "utf8") });
  return sources;
}

function readConfig(path: string): RedactConfig {
  return loadRedactConfig(readJsonFile(path));
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

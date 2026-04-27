#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeEntity,
  compareCanon,
  formatCanonResult,
  formatCompareResult,
  formatConfigSummary,
  loadCanonConfig,
  parseJson,
  resolveProfile,
} from "./index.js";
import type { CanonConfig, CanonEntityType, CanonProfile, CompanyRoleInput } from "./types.js";

const USAGE = `iso-canon - deterministic canonicalization for agent workflows

usage:
  iso-canon --version | -v
  iso-canon --help | -h
  iso-canon normalize <url|company|role> <value> [--config <file>] [--profile <name>] [--json]
  iso-canon normalize company-role --company <name> --role <title> [--config <file>] [--profile <name>] [--json]
  iso-canon key <url|company|role> <value> [--config <file>] [--profile <name>] [--json]
  iso-canon key company-role --company <name> --role <title> [--config <file>] [--profile <name>] [--json]
  iso-canon compare <url|company|role> <left> <right> [--config <file>] [--profile <name>] [--json]
  iso-canon compare company-role --left-company <name> --left-role <title> --right-company <name> --right-role <title> [--config <file>] [--profile <name>] [--json]
  iso-canon explain [--config <file>] [--profile <name>] [--json]
`;

interface CommonOptions {
  config: string;
  profile: string;
  json: boolean;
  help: boolean;
}

interface PairFlags {
  company: string;
  role: string;
  leftCompany: string;
  leftRole: string;
  rightCompany: string;
  rightRole: string;
  left: string;
  right: string;
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
    if (cmd === "normalize") return cmdNormalize(args, false);
    if (cmd === "key") return cmdNormalize(args, true);
    if (cmd === "compare") return cmdCompare(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-canon: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-canon: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdNormalize(args: string[], keyOnly: boolean): number {
  const { opts, rest } = parseCommon(args);
  const { flags, positional } = parsePairFlags(rest);
  const type = parseEntityType(positional.shift(), keyOnly ? "key" : "normalize");
  const profile = readProfile(opts);
  const input = inputForNormalize(type, positional, flags);
  const result = canonicalizeEntity(type, input, profile);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else if (keyOnly) console.log(result.key);
  else console.log(formatCanonResult(result));
  return 0;
}

function cmdCompare(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const { flags, positional } = parsePairFlags(rest);
  const type = parseEntityType(positional.shift(), "compare");
  const profile = readProfile(opts);
  const [left, right] = inputsForCompare(type, positional, flags);
  const result = compareCanon(type, left, right, profile);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCompareResult(result));
  return 0;
}

function cmdExplain(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  if (rest.length) return usageError(`explain: unknown argument "${rest[0]}"`);
  const config = readConfig(opts.config);
  const profile = resolveProfile(config, opts.profile || undefined);
  if (opts.json) console.log(JSON.stringify(profile, null, 2));
  else console.log(formatConfigSummary({ version: 1, profiles: [profile] }));
  return 0;
}

function parseCommon(args: string[]): { opts: CommonOptions; rest: string[] } {
  const opts: CommonOptions = { config: "", profile: "", json: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") opts.config = requiredValue(args, ++i, "--config");
    else if (arg.startsWith("--config=")) opts.config = arg.slice("--config=".length);
    else if (arg === "--profile") opts.profile = requiredValue(args, ++i, "--profile");
    else if (arg.startsWith("--profile=")) opts.profile = arg.slice("--profile=".length);
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

function parsePairFlags(args: string[]): { flags: PairFlags; positional: string[] } {
  const flags: PairFlags = {
    company: "",
    role: "",
    leftCompany: "",
    leftRole: "",
    rightCompany: "",
    rightRole: "",
    left: "",
    right: "",
  };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--company") flags.company = requiredValue(args, ++i, "--company");
    else if (arg.startsWith("--company=")) flags.company = arg.slice("--company=".length);
    else if (arg === "--role") flags.role = requiredValue(args, ++i, "--role");
    else if (arg.startsWith("--role=")) flags.role = arg.slice("--role=".length);
    else if (arg === "--left-company") flags.leftCompany = requiredValue(args, ++i, "--left-company");
    else if (arg.startsWith("--left-company=")) flags.leftCompany = arg.slice("--left-company=".length);
    else if (arg === "--left-role") flags.leftRole = requiredValue(args, ++i, "--left-role");
    else if (arg.startsWith("--left-role=")) flags.leftRole = arg.slice("--left-role=".length);
    else if (arg === "--right-company") flags.rightCompany = requiredValue(args, ++i, "--right-company");
    else if (arg.startsWith("--right-company=")) flags.rightCompany = arg.slice("--right-company=".length);
    else if (arg === "--right-role") flags.rightRole = requiredValue(args, ++i, "--right-role");
    else if (arg.startsWith("--right-role=")) flags.rightRole = arg.slice("--right-role=".length);
    else if (arg === "--left") flags.left = requiredValue(args, ++i, "--left");
    else if (arg.startsWith("--left=")) flags.left = arg.slice("--left=".length);
    else if (arg === "--right") flags.right = requiredValue(args, ++i, "--right");
    else if (arg.startsWith("--right=")) flags.right = arg.slice("--right=".length);
    else if (arg.startsWith("--")) throw new Error(`unknown flag "${arg}"`);
    else positional.push(arg);
  }
  return { flags, positional };
}

function inputForNormalize(type: CanonEntityType, positional: string[], flags: PairFlags): string | CompanyRoleInput {
  if (type === "company-role") {
    if (flags.company && flags.role) return { company: flags.company, role: flags.role };
    if (positional.length) return positional.join(" ");
    throw new Error("company-role requires --company and --role");
  }
  if (flags.left || flags.right || flags.company || flags.role) throw new Error(`${type}: unexpected pair flags`);
  if (positional.length !== 1) throw new Error(`${type}: provide exactly one value; quote values containing spaces`);
  return positional[0] ?? "";
}

function inputsForCompare(type: CanonEntityType, positional: string[], flags: PairFlags): [string | CompanyRoleInput, string | CompanyRoleInput] {
  if (type === "company-role") {
    if (flags.leftCompany && flags.leftRole && flags.rightCompany && flags.rightRole) {
      return [
        { company: flags.leftCompany, role: flags.leftRole },
        { company: flags.rightCompany, role: flags.rightRole },
      ];
    }
    if (flags.left && flags.right) return [flags.left, flags.right];
    if (positional.length === 2) return [positional[0] ?? "", positional[1] ?? ""];
    throw new Error("company-role compare requires left and right company-role values");
  }
  if (flags.left && flags.right) return [flags.left, flags.right];
  if (positional.length !== 2) throw new Error(`${type}: provide exactly two values; quote values containing spaces`);
  return [positional[0] ?? "", positional[1] ?? ""];
}

function readConfig(path: string): CanonConfig {
  if (!path) return { version: 1, profiles: [] };
  return loadCanonConfig(parseJson(readFileSync(resolve(path), "utf8"), path), path);
}

function readProfile(opts: CommonOptions): CanonProfile {
  return resolveProfile(readConfig(opts.config), opts.profile || undefined);
}

function parseEntityType(value: string | undefined, command: string): CanonEntityType {
  if (value === "url" || value === "company" || value === "role" || value === "company-role") return value;
  throw new Error(`${command}: expected type url, company, role, or company-role`);
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usageError(message: string): number {
  console.error(`iso-canon: ${message}`);
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

#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bundleNames,
  formatContextPlan,
  formatResolvedContextBundle,
  loadContextPolicy,
  parseJson,
  planContext,
  renderContextPlan,
  resolveContextBundle,
} from "./index.js";
import type { ContextInput, ContextPolicy, RenderTarget } from "./types.js";

const USAGE = `iso-context - deterministic context bundles for agent workflows

usage:
  iso-context --version | -v
  iso-context --help | -h
  iso-context list --policy <context.json> [--json]
  iso-context explain <bundle> --policy <context.json> [--json]
  iso-context plan <bundle> --policy <context.json> [--root <dir>] [--budget N] [--chars-per-token N] [--json]
  iso-context check <bundle> --policy <context.json> [--root <dir>] [--budget N] [--chars-per-token N] [--json]
  iso-context render <bundle> --policy <context.json> [--root <dir>] [--target markdown|json] [--json]

Policies are JSON files containing { "bundles": [...] }, one bundle,
or an array of bundles.
`;

interface CliOptions {
  policy?: string;
  root?: string;
  json: boolean;
  help: boolean;
  target: RenderTarget;
  tokenBudget?: number;
  charsPerToken?: number;
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

    if (cmd === "list") return listBundles(opts);
    if (cmd === "explain") return explain(positional, opts);
    if (cmd === "plan") return plan(positional, opts);
    if (cmd === "check") return check(positional, opts);
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
  const opts: CliOptions = {
    json: false,
    help: false,
    target: "markdown",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--policy") {
      opts.policy = valueAfter(args, ++i, "--policy");
    } else if (arg.startsWith("--policy=")) {
      opts.policy = arg.slice("--policy=".length);
    } else if (arg === "--root") {
      opts.root = valueAfter(args, ++i, "--root");
    } else if (arg.startsWith("--root=")) {
      opts.root = arg.slice("--root=".length);
    } else if (arg === "--budget" || arg === "--token-budget") {
      opts.tokenBudget = parsePositiveInteger(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith("--budget=")) {
      opts.tokenBudget = parsePositiveInteger(arg.slice("--budget=".length), "--budget");
    } else if (arg.startsWith("--token-budget=")) {
      opts.tokenBudget = parsePositiveInteger(arg.slice("--token-budget=".length), "--token-budget");
    } else if (arg === "--chars-per-token") {
      opts.charsPerToken = parsePositiveInteger(valueAfter(args, ++i, "--chars-per-token"), "--chars-per-token");
    } else if (arg.startsWith("--chars-per-token=")) {
      opts.charsPerToken = parsePositiveInteger(arg.slice("--chars-per-token=".length), "--chars-per-token");
    } else if (arg === "--target") {
      opts.target = parseTarget(valueAfter(args, ++i, "--target"));
    } else if (arg.startsWith("--target=")) {
      opts.target = parseTarget(arg.slice("--target=".length));
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

function listBundles(opts: CliOptions): number {
  const names = bundleNames(readPolicy(opts));
  if (opts.json) console.log(JSON.stringify(names, null, 2));
  else console.log(names.join("\n"));
  return 0;
}

function explain(positional: string[], opts: CliOptions): number {
  const bundle = readBundle(positional, opts);
  if (opts.json) console.log(JSON.stringify(bundle, null, 2));
  else console.log(formatResolvedContextBundle(bundle));
  return 0;
}

function plan(positional: string[], opts: CliOptions): number {
  const name = requireBundleName(positional);
  const result = planContext(readPolicy(opts), name, planOptions(opts, false));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatContextPlan(result));
  return 0;
}

function check(positional: string[], opts: CliOptions): number {
  const name = requireBundleName(positional);
  const result = planContext(readPolicy(opts), name, planOptions(opts, false));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatContextPlan(result));
  return result.ok ? 0 : 1;
}

function render(positional: string[], opts: CliOptions): number {
  const name = requireBundleName(positional);
  const result = planContext(readPolicy(opts), name, planOptions(opts, true));
  const text = renderContextPlan(result, opts.target);
  if (opts.json) console.log(JSON.stringify({ target: opts.target, plan: result, text }, null, 2));
  else console.log(text);
  return result.ok ? 0 : 1;
}

function readBundle(positional: string[], opts: CliOptions) {
  return resolveContextBundle(readPolicy(opts), requireBundleName(positional));
}

function requireBundleName(positional: string[]): string {
  const name = positional[0];
  if (!name) throw new Error("missing bundle name");
  return name;
}

function readPolicy(opts: CliOptions): ContextPolicy {
  if (!opts.policy) throw new Error("missing --policy <context.json>");
  const raw = readFileSync(resolve(opts.policy), "utf8");
  return loadContextPolicy(parseJson(raw, opts.policy) as unknown as ContextInput);
}

function planOptions(opts: CliOptions, includeContent: boolean) {
  return {
    root: opts.root,
    includeContent,
    tokenBudget: opts.tokenBudget,
    charsPerToken: opts.charsPerToken,
  };
}

function parseTarget(value: string): RenderTarget {
  if (value === "markdown" || value === "json") return value;
  throw new Error("--target must be markdown or json");
}

function parsePositiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${flag} must be a positive integer`);
  return number;
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

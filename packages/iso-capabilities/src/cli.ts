#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkRoleCapability,
  formatCheckResult,
  formatResolvedRole,
  loadCapabilityPolicy,
  parseJson,
  renderRole,
  resolveRole,
  roleNames,
} from "./index.js";
import type {
  CapabilityPolicy,
  CapabilityInput,
  CapabilityRequest,
  FilesystemAccess,
  NetworkMode,
  RenderTarget,
} from "./types.js";

const USAGE = `iso-capabilities - deterministic role capability policies for agent workflows

usage:
  iso-capabilities --version | -v
  iso-capabilities --help | -h
  iso-capabilities list --policy <capabilities.json> [--json]
  iso-capabilities explain <role> --policy <capabilities.json> [--json]
  iso-capabilities check <role> --policy <capabilities.json> [--tool <name>] [--mcp <name>] [--command <cmd>] [--filesystem read|write] [--network off|restricted|on] [--json]
  iso-capabilities render <role> --policy <capabilities.json> [--target markdown|claude|codex|cursor|opencode|json] [--json]

Policies are JSON files containing either { "roles": [...] }, one role,
or an array of roles.
`;

interface CliOptions {
  policy?: string;
  json: boolean;
  help: boolean;
  target: RenderTarget;
  tools: string[];
  mcp: string[];
  commands: string[];
  filesystem: FilesystemAccess[];
  network?: NetworkMode;
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

    if (cmd === "list") return listRoles(opts);
    if (cmd === "explain") return explain(positional, opts);
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
    tools: [],
    mcp: [],
    commands: [],
    filesystem: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--policy") {
      opts.policy = valueAfter(args, ++i, "--policy");
    } else if (arg.startsWith("--policy=")) {
      opts.policy = arg.slice("--policy=".length);
    } else if (arg === "--tool") {
      opts.tools.push(valueAfter(args, ++i, "--tool"));
    } else if (arg.startsWith("--tool=")) {
      opts.tools.push(arg.slice("--tool=".length));
    } else if (arg === "--mcp") {
      opts.mcp.push(valueAfter(args, ++i, "--mcp"));
    } else if (arg.startsWith("--mcp=")) {
      opts.mcp.push(arg.slice("--mcp=".length));
    } else if (arg === "--command") {
      opts.commands.push(valueAfter(args, ++i, "--command"));
    } else if (arg.startsWith("--command=")) {
      opts.commands.push(arg.slice("--command=".length));
    } else if (arg === "--filesystem") {
      opts.filesystem.push(parseFilesystem(valueAfter(args, ++i, "--filesystem")));
    } else if (arg.startsWith("--filesystem=")) {
      opts.filesystem.push(parseFilesystem(arg.slice("--filesystem=".length)));
    } else if (arg === "--network") {
      opts.network = parseNetwork(valueAfter(args, ++i, "--network"));
    } else if (arg.startsWith("--network=")) {
      opts.network = parseNetwork(arg.slice("--network=".length));
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

function listRoles(opts: CliOptions): number {
  const names = roleNames(readPolicy(opts));
  if (opts.json) console.log(JSON.stringify(names, null, 2));
  else console.log(names.join("\n"));
  return 0;
}

function explain(positional: string[], opts: CliOptions): number {
  const role = readRole(positional, opts);
  if (opts.json) console.log(JSON.stringify(role, null, 2));
  else console.log(formatResolvedRole(role));
  return 0;
}

function check(positional: string[], opts: CliOptions): number {
  const name = positional[0];
  if (!name) throw new Error("missing role name");
  const request = requestFromOptions(opts);
  if (!hasRequest(request)) {
    throw new Error("check requires at least one --tool, --mcp, --command, --filesystem, or --network");
  }
  const result = checkRoleCapability(readPolicy(opts), name, request);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheckResult(result));
  return result.ok ? 0 : 1;
}

function render(positional: string[], opts: CliOptions): number {
  const role = readRole(positional, opts);
  const text = renderRole(role, opts.target);
  if (opts.json) console.log(JSON.stringify({ target: opts.target, role, text }, null, 2));
  else console.log(text);
  return 0;
}

function readRole(positional: string[], opts: CliOptions) {
  const name = positional[0];
  if (!name) throw new Error("missing role name");
  return resolveRole(readPolicy(opts), name);
}

function readPolicy(opts: CliOptions): CapabilityPolicy {
  if (!opts.policy) throw new Error("missing --policy <capabilities.json>");
  const raw = readFileSync(resolve(opts.policy), "utf8");
  return loadCapabilityPolicy(parseJson(raw, opts.policy) as unknown as CapabilityInput);
}

function requestFromOptions(opts: CliOptions): CapabilityRequest {
  return {
    tools: opts.tools.length ? opts.tools : undefined,
    mcp: opts.mcp.length ? opts.mcp : undefined,
    commands: opts.commands.length ? opts.commands : undefined,
    filesystem: opts.filesystem.length ? opts.filesystem : undefined,
    network: opts.network,
  };
}

function hasRequest(request: CapabilityRequest): boolean {
  return Boolean(
    request.tools?.length ||
      request.mcp?.length ||
      request.commands?.length ||
      request.filesystem?.length ||
      request.network,
  );
}

function parseFilesystem(value: string): FilesystemAccess {
  if (value === "read" || value === "write") return value;
  throw new Error("--filesystem must be read or write");
}

function parseNetwork(value: string): NetworkMode {
  if (value === "off" || value === "restricted" || value === "on") return value;
  throw new Error("--network must be off, restricted, or on");
}

function parseTarget(value: string): RenderTarget {
  if (
    value === "markdown" ||
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "json"
  ) {
    return value;
  }
  throw new Error("--target must be markdown, claude, codex, cursor, opencode, or json");
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

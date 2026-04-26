#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./audit.js";
import { loadEvents } from "./events.js";
import { formatAuditResult, formatPolicyExplanation, resultFails, type FailOn } from "./format.js";
import { loadPolicy } from "./policy.js";

const USAGE = `iso-guard — deterministic policy checks for agent workflow traces

usage:
  iso-guard --version | -v
  iso-guard --help | -h
  iso-guard audit   <policy.yaml> --events <events.json|jsonl> [--json] [--fail-on error|warn|off]
  iso-guard verify  <policy.yaml> --events <events.json|jsonl> [--json] [--fail-on error|warn|off]
  iso-guard explain <policy.yaml> [--json]

"audit" and "verify" are aliases. Event input may be normalized guard events
or an "iso-trace export" JSON/JSONL session.
`;

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

interface AuditArgs {
  policyPath: string;
  eventsPath: string;
  json: boolean;
  failOn: FailOn;
}

function parseAuditArgs(command: string, args: string[]): AuditArgs | string {
  if (args.length === 0) return `iso-guard ${command}: missing <policy.yaml>`;
  const policyPath = args[0] ?? "";
  let eventsPath = "";
  let json = false;
  let failOn: FailOn = "error";

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--events") {
      eventsPath = args[++i] ?? "";
      if (!eventsPath) return `iso-guard ${command}: --events requires a path`;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--fail-on") {
      const value = args[++i] ?? "";
      if (value !== "error" && value !== "warn" && value !== "off") {
        return `iso-guard ${command}: --fail-on must be error, warn, or off`;
      }
      failOn = value;
    } else {
      return `iso-guard ${command}: unknown flag "${arg}"`;
    }
  }

  if (!eventsPath) return `iso-guard ${command}: --events is required`;
  return { policyPath, eventsPath, json, failOn };
}

function cmdAudit(command: string, args: string[]): number {
  const opts = parseAuditArgs(command, args);
  if (typeof opts === "string") {
    console.error(opts);
    return 2;
  }
  const policy = loadPolicy(opts.policyPath);
  const events = loadEvents(opts.eventsPath);
  const result = audit(policy, events);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatAuditResult(result));
  return resultFails(result, opts.failOn) ? 1 : 0;
}

function cmdExplain(args: string[]): number {
  if (args.length === 0) {
    console.error("iso-guard explain: missing <policy.yaml>");
    return 2;
  }
  let json = false;
  const policyPath = args[0] ?? "";
  for (const arg of args.slice(1)) {
    if (arg === "--json") json = true;
    else {
      console.error(`iso-guard explain: unknown flag "${arg}"`);
      return 2;
    }
  }
  const policy = loadPolicy(policyPath);
  if (json) console.log(JSON.stringify(policy, null, 2));
  else console.log(formatPolicyExplanation(policy));
  return 0;
}

export function main(argv = process.argv.slice(2)): number {
  const [cmd, ...args] = argv;
  try {
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
      console.log(USAGE);
      return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
      console.log(readVersion());
      return 0;
    }
    if (cmd === "audit" || cmd === "verify") return cmdAudit(cmd, args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-guard: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`iso-guard: ${message}`);
    return 2;
  }
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

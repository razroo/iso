#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEvent,
  formatEvents,
  formatMaterializedLedger,
  formatVerifyResult,
  hasEvent,
  initLedger,
  materializeLedger,
  queryEvents,
  readLedger,
  resolveLedgerPath,
  verifyLedger,
} from "./index.js";
import { parseJsonObject } from "./json.js";
import type { JsonObject, JsonPrimitive, LedgerEventInput, LedgerOptions, QueryOptions } from "./types.js";

const USAGE = `iso-ledger — deterministic append-only event ledger for agent workflows

usage:
  iso-ledger --version | -v
  iso-ledger --help | -h
  iso-ledger init [--ledger <events.jsonl>] [--dir <dir>]
  iso-ledger append <type> [--ledger <events.jsonl>] [--key <key>] [--subject <subject>] [--idempotency-key <key>] [--at <iso>] [--data <json|@file>] [--meta <json|@file>] [--json]
  iso-ledger query [--ledger <events.jsonl>] [--type <type>] [--key <key>] [--subject <subject>] [--where <path=value>] [--limit <n>] [--json]
  iso-ledger has [--ledger <events.jsonl>] [--type <type>] [--key <key>] [--subject <subject>] [--where <path=value>] [--json]
  iso-ledger verify [--ledger <events.jsonl>] [--json]
  iso-ledger materialize [--ledger <events.jsonl>] [--out <state.json>] [--json]

Default ledger path: .iso-ledger/events.jsonl under the current directory.
`;

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

interface CommonArgs {
  ledger: LedgerOptions;
  json: boolean;
  rest: string[];
}

function parseCommon(args: string[]): CommonArgs | string {
  const rest: string[] = [];
  const ledger: LedgerOptions = {};
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ledger") {
      ledger.path = args[++i] ?? "";
      if (!ledger.path) return "--ledger requires a path";
    } else if (arg.startsWith("--ledger=")) {
      ledger.path = arg.slice("--ledger=".length);
    } else if (arg === "--dir") {
      ledger.dir = args[++i] ?? "";
      if (!ledger.dir) return "--dir requires a path";
    } else if (arg.startsWith("--dir=")) {
      ledger.dir = arg.slice("--dir=".length);
    } else if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }
  return { ledger, json, rest };
}

function cmdInit(args: string[]): number {
  const parsed = parseCommon(args);
  if (typeof parsed === "string") return usageError("init", parsed);
  const path = initLedger(parsed.ledger);
  if (parsed.json) console.log(JSON.stringify({ path }, null, 2));
  else console.log(`iso-ledger: initialized ${path}`);
  return 0;
}

function cmdAppend(args: string[]): number {
  const parsed = parseCommon(args);
  if (typeof parsed === "string") return usageError("append", parsed);
  const [type, ...flags] = parsed.rest;
  if (!type) return usageError("append", "missing <type>");

  const input: LedgerEventInput = { type };
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === "--key") input.key = requiredValue(flags, ++i, "--key");
    else if (arg.startsWith("--key=")) input.key = arg.slice("--key=".length);
    else if (arg === "--subject") input.subject = requiredValue(flags, ++i, "--subject");
    else if (arg.startsWith("--subject=")) input.subject = arg.slice("--subject=".length);
    else if (arg === "--idempotency-key") input.idempotencyKey = requiredValue(flags, ++i, "--idempotency-key");
    else if (arg.startsWith("--idempotency-key=")) input.idempotencyKey = arg.slice("--idempotency-key=".length);
    else if (arg === "--at") input.at = requiredValue(flags, ++i, "--at");
    else if (arg.startsWith("--at=")) input.at = arg.slice("--at=".length);
    else if (arg === "--data") input.data = readJsonObjectArg(requiredValue(flags, ++i, "--data"), "--data");
    else if (arg.startsWith("--data=")) input.data = readJsonObjectArg(arg.slice("--data=".length), "--data");
    else if (arg === "--meta") input.meta = readJsonObjectArg(requiredValue(flags, ++i, "--meta"), "--meta");
    else if (arg.startsWith("--meta=")) input.meta = readJsonObjectArg(arg.slice("--meta=".length), "--meta");
    else return usageError("append", `unknown flag "${arg}"`);
  }

  const result = appendEvent(parsed.ledger, input);
  if (parsed.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`iso-ledger: ${result.appended ? "APPENDED" : "EXISTS"} ${result.event.id}`);
  return 0;
}

function cmdQuery(args: string[], mode: "query" | "has"): number {
  const parsed = parseCommon(args);
  if (typeof parsed === "string") return usageError(mode, parsed);
  const query = parseQueryFlags(parsed.rest, mode);
  if (typeof query === "string") return usageError(mode, query);
  const events = readLedger(parsed.ledger);
  const matches = queryEvents(events, query);
  if (mode === "has") {
    const matched = hasEvent(events, query);
    if (parsed.json) console.log(JSON.stringify({ matched, count: matches.length }, null, 2));
    else console.log(matched ? `iso-ledger: MATCH (${matches.length} event(s))` : "iso-ledger: NO MATCH");
    return matched ? 0 : 1;
  }
  if (parsed.json) console.log(JSON.stringify(matches, null, 2));
  else console.log(formatEvents(matches));
  return 0;
}

function cmdVerify(args: string[]): number {
  const parsed = parseCommon(args);
  if (typeof parsed === "string") return usageError("verify", parsed);
  if (parsed.rest.length > 0) return usageError("verify", `unknown argument "${parsed.rest[0]}"`);
  const result = verifyLedger(parsed.ledger);
  if (parsed.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
  return result.ok ? 0 : 1;
}

function cmdMaterialize(args: string[]): number {
  const parsed = parseCommon(args);
  if (typeof parsed === "string") return usageError("materialize", parsed);
  let outPath = "";
  for (let i = 0; i < parsed.rest.length; i++) {
    const arg = parsed.rest[i];
    if (arg === "--out") outPath = requiredValue(parsed.rest, ++i, "--out");
    else if (arg.startsWith("--out=")) outPath = arg.slice("--out=".length);
    else return usageError("materialize", `unknown flag "${arg}"`);
  }
  const view = materializeLedger(readLedger(parsed.ledger));
  if (outPath) writeFileSync(resolve(outPath), `${JSON.stringify(view, null, 2)}\n`);
  if (parsed.json) console.log(JSON.stringify(view, null, 2));
  else console.log(outPath ? `iso-ledger: wrote ${resolve(outPath)}` : formatMaterializedLedger(view));
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
    if (cmd === "init") return cmdInit(args);
    if (cmd === "append") return cmdAppend(args);
    if (cmd === "query") return cmdQuery(args, "query");
    if (cmd === "has") return cmdQuery(args, "has");
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "materialize") return cmdMaterialize(args);
    console.error(`iso-ledger: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`iso-ledger: ${message}`);
    return 2;
  }
}

function parseQueryFlags(args: string[], command: string): QueryOptions | string {
  const query: QueryOptions = {};
  const where: Record<string, JsonPrimitive> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--type") query.type = requiredValue(args, ++i, "--type");
    else if (arg.startsWith("--type=")) query.type = arg.slice("--type=".length);
    else if (arg === "--key") query.key = requiredValue(args, ++i, "--key");
    else if (arg.startsWith("--key=")) query.key = arg.slice("--key=".length);
    else if (arg === "--subject") query.subject = requiredValue(args, ++i, "--subject");
    else if (arg.startsWith("--subject=")) query.subject = arg.slice("--subject=".length);
    else if (arg === "--where") parseWhere(requiredValue(args, ++i, "--where"), where);
    else if (arg.startsWith("--where=")) parseWhere(arg.slice("--where=".length), where);
    else if (arg === "--limit") query.limit = parseLimit(requiredValue(args, ++i, "--limit"));
    else if (arg.startsWith("--limit=")) query.limit = parseLimit(arg.slice("--limit=".length));
    else return `${command}: unknown flag "${arg}"`;
  }
  if (Object.keys(where).length > 0) query.where = where;
  return query;
}

function parseWhere(raw: string, out: Record<string, JsonPrimitive>): void {
  const eq = raw.indexOf("=");
  if (eq <= 0) throw new Error(`--where must be path=value, got "${raw}"`);
  out[raw.slice(0, eq)] = parseScalar(raw.slice(eq + 1));
}

function parseScalar(raw: string): JsonPrimitive {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseLimit(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer");
  return n;
}

function readJsonObjectArg(raw: string, flag: string): JsonObject {
  const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  return parseJsonObject(text, flag);
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usageError(command: string, message: string): number {
  console.error(`iso-ledger ${command}: ${message}`);
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

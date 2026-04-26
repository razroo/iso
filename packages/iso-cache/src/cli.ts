#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cacheKey,
  formatCacheEntries,
  formatCacheEntry,
  formatPruneResult,
  formatVerifyResult,
  hasCacheEntry,
  listCacheEntries,
  parseJson,
  pruneCache,
  putCacheEntry,
  readCacheContent,
  verifyCache,
} from "./index.js";
import type { JsonObject, JsonValue } from "./types.js";

const USAGE = `iso-cache - deterministic local artifact cache for agent workflows

usage:
  iso-cache --version | -v
  iso-cache --help | -h
  iso-cache key [--namespace <name>] [--version <version>] [--part <value>]... [--json]
  iso-cache put <key> --input <text|@file> [--cache <dir>] [--kind <kind>] [--ttl <duration>] [--expires-at <iso>] [--content-type <type>] [--meta <json|@file>] [--json]
  iso-cache get <key> [--cache <dir>] [--allow-expired] [--output <file>] [--json]
  iso-cache has <key> [--cache <dir>] [--allow-expired] [--json]
  iso-cache list [--cache <dir>] [--kind <kind>] [--include-expired] [--json]
  iso-cache verify [--cache <dir>] [--json]
  iso-cache prune [--cache <dir>] [--expired] [--dry-run] [--json]

Default cache path: .iso-cache under the current directory.
Durations accept ms, s, m, h, or d suffixes (for example: 30m, 12h, 7d).
`;

interface CommonOptions {
  cache: string;
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
    if (cmd === "key") return cmdKey(args);
    if (cmd === "put") return cmdPut(args);
    if (cmd === "get") return cmdGet(args);
    if (cmd === "has") return cmdHas(args);
    if (cmd === "list") return cmdList(args);
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "prune") return cmdPrune(args);
    console.error(`iso-cache: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-cache: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function cmdKey(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const parts: JsonValue[] = [];
  let namespace = "cache";
  let version: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--namespace") namespace = requiredValue(rest, ++i, "--namespace");
    else if (arg.startsWith("--namespace=")) namespace = arg.slice("--namespace=".length);
    else if (arg === "--version") version = requiredValue(rest, ++i, "--version");
    else if (arg.startsWith("--version=")) version = arg.slice("--version=".length);
    else if (arg === "--part") parts.push(parsePart(requiredValue(rest, ++i, "--part")));
    else if (arg.startsWith("--part=")) parts.push(parsePart(arg.slice("--part=".length)));
    else return usageError(`key: unknown flag "${arg}"`);
  }
  const key = cacheKey({ namespace, version, parts });
  if (opts.json) console.log(JSON.stringify({ key }, null, 2));
  else console.log(key);
  return 0;
}

function cmdPut(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const [key, ...flags] = rest;
  if (!key) return usageError("put: missing <key>");
  let input: string | undefined;
  let kind: string | undefined;
  let contentType: string | undefined;
  let ttlMs: number | undefined;
  let expiresAt: string | undefined;
  let metadata: JsonObject | undefined;
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === "--input") input = readInputArg(requiredValue(flags, ++i, "--input"));
    else if (arg.startsWith("--input=")) input = readInputArg(arg.slice("--input=".length));
    else if (arg === "--kind") kind = requiredValue(flags, ++i, "--kind");
    else if (arg.startsWith("--kind=")) kind = arg.slice("--kind=".length);
    else if (arg === "--content-type") contentType = requiredValue(flags, ++i, "--content-type");
    else if (arg.startsWith("--content-type=")) contentType = arg.slice("--content-type=".length);
    else if (arg === "--ttl") ttlMs = parseDuration(requiredValue(flags, ++i, "--ttl"));
    else if (arg.startsWith("--ttl=")) ttlMs = parseDuration(arg.slice("--ttl=".length));
    else if (arg === "--expires-at") expiresAt = requiredValue(flags, ++i, "--expires-at");
    else if (arg.startsWith("--expires-at=")) expiresAt = arg.slice("--expires-at=".length);
    else if (arg === "--meta") metadata = readJsonObjectArg(requiredValue(flags, ++i, "--meta"), "--meta");
    else if (arg.startsWith("--meta=")) metadata = readJsonObjectArg(arg.slice("--meta=".length), "--meta");
    else return usageError(`put: unknown flag "${arg}"`);
  }
  if (input === undefined) return usageError("put: --input is required");
  const entry = putCacheEntry(opts.cache, key, input, { kind, contentType, ttlMs, expiresAt, metadata });
  if (opts.json) console.log(JSON.stringify(entry, null, 2));
  else console.log(`iso-cache: STORED ${entry.key} ${entry.contentHash}`);
  return 0;
}

function cmdGet(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const [key, ...flags] = rest;
  if (!key) return usageError("get: missing <key>");
  let allowExpired = false;
  let output = "";
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === "--allow-expired") allowExpired = true;
    else if (arg === "--output") output = requiredValue(flags, ++i, "--output");
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
    else return usageError(`get: unknown flag "${arg}"`);
  }
  const hit = readCacheContent(opts.cache, key, { allowExpired });
  if (!hit?.hit || hit.content === undefined || !hit.entry) {
    if (opts.json) console.log(JSON.stringify({ hit: false, stale: Boolean(hit?.stale) }, null, 2));
    else console.log("iso-cache: MISS");
    return 1;
  }
  if (output) writeFileSync(resolve(output), hit.content, "utf8");
  if (opts.json) console.log(JSON.stringify(hit, null, 2));
  else if (output) console.log(`iso-cache: WROTE ${resolve(output)}`);
  else console.log(hit.content);
  return 0;
}

function cmdHas(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const [key, ...flags] = rest;
  if (!key) return usageError("has: missing <key>");
  let allowExpired = false;
  for (const arg of flags) {
    if (arg === "--allow-expired") allowExpired = true;
    else return usageError(`has: unknown flag "${arg}"`);
  }
  const hit = hasCacheEntry(opts.cache, key, { allowExpired });
  if (opts.json) console.log(JSON.stringify({ hit }, null, 2));
  else console.log(hit ? "iso-cache: HIT" : "iso-cache: MISS");
  return hit ? 0 : 1;
}

function cmdList(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let kind: string | undefined;
  let includeExpired = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--kind") kind = requiredValue(rest, ++i, "--kind");
    else if (arg.startsWith("--kind=")) kind = arg.slice("--kind=".length);
    else if (arg === "--include-expired") includeExpired = true;
    else return usageError(`list: unknown flag "${arg}"`);
  }
  const entries = listCacheEntries(opts.cache, { kind, includeExpired });
  if (opts.json) console.log(JSON.stringify(entries, null, 2));
  else console.log(formatCacheEntries(entries));
  return 0;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  if (rest.length) return usageError(`verify: unknown argument "${rest[0]}"`);
  const result = verifyCache(opts.cache);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
  return result.ok ? 0 : 1;
}

function cmdPrune(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let expired = false;
  let dryRun = false;
  for (const arg of rest) {
    if (arg === "--expired") expired = true;
    else if (arg === "--dry-run") dryRun = true;
    else return usageError(`prune: unknown flag "${arg}"`);
  }
  const result = pruneCache(opts.cache, { expired: expired || undefined, dryRun });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatPruneResult(result));
  return 0;
}

function parseCommon(args: string[]): { opts: CommonOptions; rest: string[] } {
  const opts: CommonOptions = { cache: ".iso-cache", json: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cache" || arg === "--dir") opts.cache = requiredValue(args, ++i, arg);
    else if (arg.startsWith("--cache=")) opts.cache = arg.slice("--cache=".length);
    else if (arg.startsWith("--dir=")) opts.cache = arg.slice("--dir=".length);
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

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function readInputArg(raw: string): string {
  if (raw === "-") return readFileSync(0, "utf8");
  if (raw.startsWith("@")) return readFileSync(resolve(raw.slice(1)), "utf8");
  return raw;
}

function readJsonObjectArg(raw: string, label: string): JsonObject {
  const text = raw.startsWith("@") ? readFileSync(resolve(raw.slice(1)), "utf8") : raw;
  const parsed = parseJson(text, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonObject;
}

function parsePart(raw: string): JsonValue {
  if (raw.startsWith("@")) return parseJson(readFileSync(resolve(raw.slice(1)), "utf8"), "--part");
  return raw;
}

function parseDuration(raw: string): number {
  const match = raw.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) throw new Error(`invalid duration "${raw}"`);
  const value = Number(match[1]);
  const unit = match[2] || "ms";
  const multiplier = unit === "ms" ? 1
    : unit === "s" ? 1000
      : unit === "m" ? 60_000
        : unit === "h" ? 3_600_000
          : 86_400_000;
  return value * multiplier;
}

function usageError(message: string): number {
  console.error(`iso-cache: ${message}`);
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

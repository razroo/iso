#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkTimeline,
  filterTimelineResult,
  formatCheckResult,
  formatConfigSummary,
  formatTimelineResult,
  formatVerifyResult,
  loadTimelineConfig,
  parseJson,
  parseJsonLines,
  planTimeline,
  verifyTimelineResult,
} from "./index.js";
import type { TimelineConfig, TimelineItemState, TimelineResult } from "./types.js";

const USAGE = `iso-timeline - deterministic time-based next-action planning for agent workflows

usage:
  iso-timeline --version | -v
  iso-timeline --help | -h
  iso-timeline plan --config <file> --events <file> [--now <iso>] [--out <file>] [--json]
  iso-timeline due --config <file> --events <file> [--now <iso>] [--out <file>] [--json]
  iso-timeline check --config <file> --events <file> [--now <iso>] [--fail-on overdue|due|none] [--json]
  iso-timeline verify --timeline <file> [--json]
  iso-timeline explain --config <file> [--json]

Events may be a JSON array, {"events":[...]}, or JSONL with one event per line.
`;

interface CommonOptions {
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
    if (cmd === "plan") return cmdPlan(args, false);
    if (cmd === "due") return cmdPlan(args, true);
    if (cmd === "check") return cmdCheck(args);
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-timeline: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-timeline: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdPlan(args: string[], dueOnly: boolean): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let eventsPath = "";
  let now = "";
  let out = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--events") eventsPath = requiredValue(rest, ++i, "--events");
    else if (arg.startsWith("--events=")) eventsPath = arg.slice("--events=".length);
    else if (arg === "--now") now = requiredValue(rest, ++i, "--now");
    else if (arg.startsWith("--now=")) now = arg.slice("--now=".length);
    else if (arg === "--out") out = requiredValue(rest, ++i, "--out");
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else return usageError(`${dueOnly ? "due" : "plan"}: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError(`${dueOnly ? "due" : "plan"}: --config is required`);
  if (!eventsPath) return usageError(`${dueOnly ? "due" : "plan"}: --events is required`);
  const result = dueOnly
    ? filterTimelineResult(planTimeline(readConfig(configPath), readEvents(eventsPath), { now: now || undefined }), ["due", "overdue"])
    : planTimeline(readConfig(configPath), readEvents(eventsPath), { now: now || undefined });
  if (out) writeFileSync(resolve(out), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatTimelineResult(result));
  return 0;
}

function cmdCheck(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let configPath = "";
  let eventsPath = "";
  let now = "";
  let failOn: TimelineItemState[] | "none" | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--config") configPath = requiredValue(rest, ++i, "--config");
    else if (arg.startsWith("--config=")) configPath = arg.slice("--config=".length);
    else if (arg === "--events") eventsPath = requiredValue(rest, ++i, "--events");
    else if (arg.startsWith("--events=")) eventsPath = arg.slice("--events=".length);
    else if (arg === "--now") now = requiredValue(rest, ++i, "--now");
    else if (arg.startsWith("--now=")) now = arg.slice("--now=".length);
    else if (arg === "--fail-on") failOn = parseFailOn(requiredValue(rest, ++i, "--fail-on"));
    else if (arg.startsWith("--fail-on=")) failOn = parseFailOn(arg.slice("--fail-on=".length));
    else return usageError(`check: unknown flag "${arg}"`);
  }
  if (!configPath) return usageError("check: --config is required");
  if (!eventsPath) return usageError("check: --events is required");
  const result = checkTimeline(readConfig(configPath), readEvents(eventsPath), { now: now || undefined, failOn });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheckResult(result));
  return result.ok ? 0 : 1;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let timelinePath = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--timeline") timelinePath = requiredValue(rest, ++i, "--timeline");
    else if (arg.startsWith("--timeline=")) timelinePath = arg.slice("--timeline=".length);
    else return usageError(`verify: unknown flag "${arg}"`);
  }
  if (!timelinePath) return usageError("verify: --timeline is required");
  const result = verifyTimelineResult(readJson(timelinePath));
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
  const opts: CommonOptions = { json: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else rest.push(arg);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  return { opts, rest };
}

function parseFailOn(input: string): TimelineItemState[] | "none" {
  if (input === "none") return "none";
  return input.split(",").map((item) => {
    const value = item.trim();
    if (!isTimelineItemState(value)) throw new Error(`unknown --fail-on state "${value}"`);
    return value;
  });
}

function isTimelineItemState(value: string): value is TimelineItemState {
  return value === "upcoming" || value === "due" || value === "overdue" || value === "suppressed" || value === "blocked";
}

function readConfig(path: string): TimelineConfig {
  return loadTimelineConfig(readJson(path));
}

function readEvents(path: string): unknown {
  const text = readFileSync(resolve(path), "utf8");
  try {
    return parseJson(text, path);
  } catch (error) {
    if (!text.trim().includes("\n")) throw error;
    return parseJsonLines(text, path);
  }
}

function readJson(path: string): TimelineResult | TimelineConfig | unknown {
  return parseJson(readFileSync(resolve(path), "utf8"), path);
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usageError(message: string): number {
  console.error(`iso-timeline: ${message}`);
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

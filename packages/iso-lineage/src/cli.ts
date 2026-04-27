#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLineage,
  emptyLineageGraph,
  formatCheckResult,
  formatExplainGraph,
  formatRecordResult,
  formatStaleResult,
  formatVerifyResult,
  loadLineageGraph,
  parseJson,
  recordLineage,
  verifyLineageGraph,
} from "./index.js";
import type { JsonObject, LineageGraph } from "./types.js";

const DEFAULT_GRAPH = ".iso-lineage.json";

const USAGE = `iso-lineage - deterministic artifact lineage and stale-output detection for agent workflows

usage:
  iso-lineage --version | -v
  iso-lineage --help | -h
  iso-lineage record --artifact <file> [--graph <file>] [--root <dir>] [--input <file>...] [--optional-input <file>...] [--kind <kind>] [--command <cmd>] [--metadata <json>] [--json]
  iso-lineage check [--graph <file>] [--root <dir>] [--artifact <file>] [--json]
  iso-lineage stale [--graph <file>] [--root <dir>] [--json]
  iso-lineage verify [--graph <file>] [--json]
  iso-lineage explain [--graph <file>] [--root <dir>] [--artifact <file>] [--json]
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
    if (cmd === "record") return cmdRecord(args);
    if (cmd === "check") return cmdCheck(args);
    if (cmd === "stale") return cmdStale(args);
    if (cmd === "verify") return cmdVerify(args);
    if (cmd === "explain") return cmdExplain(args);
    console.error(`iso-lineage: unknown command "${cmd}"`);
    return 2;
  } catch (error) {
    console.error(`iso-lineage: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function cmdRecord(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let graphPath = DEFAULT_GRAPH;
  let root = process.cwd();
  let artifact = "";
  let kind = "";
  let command = "";
  let metadata: JsonObject | undefined;
  const inputs: string[] = [];
  const optionalInputs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--graph") graphPath = requiredValue(rest, ++i, "--graph");
    else if (arg.startsWith("--graph=")) graphPath = arg.slice("--graph=".length);
    else if (arg === "--root") root = requiredValue(rest, ++i, "--root");
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else if (arg === "--artifact") artifact = requiredValue(rest, ++i, "--artifact");
    else if (arg.startsWith("--artifact=")) artifact = arg.slice("--artifact=".length);
    else if (arg === "--input") inputs.push(requiredValue(rest, ++i, "--input"));
    else if (arg.startsWith("--input=")) inputs.push(arg.slice("--input=".length));
    else if (arg === "--optional-input") optionalInputs.push(requiredValue(rest, ++i, "--optional-input"));
    else if (arg.startsWith("--optional-input=")) optionalInputs.push(arg.slice("--optional-input=".length));
    else if (arg === "--kind") kind = requiredValue(rest, ++i, "--kind");
    else if (arg.startsWith("--kind=")) kind = arg.slice("--kind=".length);
    else if (arg === "--command") command = requiredValue(rest, ++i, "--command");
    else if (arg.startsWith("--command=")) command = arg.slice("--command=".length);
    else if (arg === "--metadata") metadata = parseMetadata(requiredValue(rest, ++i, "--metadata"));
    else if (arg.startsWith("--metadata=")) metadata = parseMetadata(arg.slice("--metadata=".length));
    else return usageError(`record: unknown flag "${arg}"`);
  }
  if (!artifact) return usageError("record: --artifact is required");
  const graph = readGraphIfExists(graphPath);
  const updated = recordLineage(graph, {
    root,
    artifact,
    inputs,
    optionalInputs,
    ...(kind ? { kind } : {}),
    ...(command ? { command } : {}),
    ...(metadata ? { metadata } : {}),
  });
  writeGraph(graphPath, updated);
  const record = updated.records.find((item) => item.artifact.path === normalizeArtifact(root, artifact));
  if (!record) throw new Error("record was not written");
  if (opts.json) console.log(JSON.stringify({ graph: updated, record }, null, 2));
  else console.log(formatRecordResult(updated, record, graphPath));
  return 0;
}

function cmdCheck(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const parsed = parseGraphRootArtifact(rest, "check");
  if (typeof parsed === "number") return parsed;
  const graph = readGraph(parsed.graphPath);
  const result = checkLineage(graph, { root: parsed.root, ...(parsed.artifact ? { artifact: parsed.artifact } : {}) });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatCheckResult(result));
  return result.ok ? 0 : 1;
}

function cmdStale(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const parsed = parseGraphRootArtifact(rest, "stale", false);
  if (typeof parsed === "number") return parsed;
  const graph = readGraph(parsed.graphPath);
  const result = checkLineage(graph, { root: parsed.root });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatStaleResult(result));
  return 0;
}

function cmdVerify(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  let graphPath = DEFAULT_GRAPH;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--graph") graphPath = requiredValue(rest, ++i, "--graph");
    else if (arg.startsWith("--graph=")) graphPath = arg.slice("--graph=".length);
    else return usageError(`verify: unknown flag "${arg}"`);
  }
  const result = verifyLineageGraph(readGraph(graphPath));
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerifyResult(result));
  return result.ok ? 0 : 1;
}

function cmdExplain(args: string[]): number {
  const { opts, rest } = parseCommon(args);
  const parsed = parseGraphRootArtifact(rest, "explain");
  if (typeof parsed === "number") return parsed;
  const graph = readGraph(parsed.graphPath);
  const artifact = parsed.artifact ? normalizeArtifact(parsed.root, parsed.artifact) : undefined;
  if (opts.json) {
    const records = artifact ? graph.records.filter((record) => record.artifact.path === artifact) : graph.records;
    console.log(JSON.stringify({ ...graph, records }, null, 2));
  } else {
    console.log(formatExplainGraph(graph, artifact));
  }
  return 0;
}

function parseGraphRootArtifact(args: string[], command: string, allowArtifact = true): { graphPath: string; root: string; artifact: string } | number {
  let graphPath = DEFAULT_GRAPH;
  let root = process.cwd();
  let artifact = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--graph") graphPath = requiredValue(args, ++i, "--graph");
    else if (arg.startsWith("--graph=")) graphPath = arg.slice("--graph=".length);
    else if (arg === "--root") root = requiredValue(args, ++i, "--root");
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else if (allowArtifact && arg === "--artifact") artifact = requiredValue(args, ++i, "--artifact");
    else if (allowArtifact && arg.startsWith("--artifact=")) artifact = arg.slice("--artifact=".length);
    else return usageError(`${command}: unknown flag "${arg}"`);
  }
  return { graphPath, root, artifact };
}

function parseCommon(args: string[]): { opts: CommonOptions; rest: string[] } {
  const opts: CommonOptions = { json: false, help: false };
  const rest: string[] = [];
  for (const arg of args) {
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

function parseMetadata(value: string): JsonObject {
  const parsed = parseJson(value, "--metadata");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--metadata must be a JSON object");
  return parsed;
}

function readGraphIfExists(path: string): LineageGraph {
  const full = resolve(path);
  if (!existsSync(full)) return emptyLineageGraph();
  return readGraph(full);
}

function readGraph(path: string): LineageGraph {
  return loadLineageGraph(parseJson(readFileSync(resolve(path), "utf8"), path));
}

function writeGraph(path: string, graph: LineageGraph): void {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function normalizeArtifact(root: string, artifact: string): string {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, artifact);
  const rel = relative(absRoot, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(/[/\\]/).join("/");
  return abs.split(/[/\\]/).join("/");
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usageError(message: string): number {
  console.error(`iso-lineage: ${message}`);
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

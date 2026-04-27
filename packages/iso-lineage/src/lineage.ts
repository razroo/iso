import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isJsonObject, stableStringify, toJsonValue } from "./json.js";
import type {
  CheckLineageOptions,
  LineageCheckResult,
  LineageGraph,
  LineageInput,
  LineageInputCheck,
  LineageIssue,
  LineageRecord,
  LineageRecordCheck,
  LineageRecordState,
  LineageSnapshot,
  LineageVerifyResult,
  RecordLineageOptions,
} from "./types.js";

export function emptyLineageGraph(): LineageGraph {
  const graph: LineageGraph = { schemaVersion: 1, id: "", records: [] };
  graph.id = lineageGraphId(graph);
  return graph;
}

export function loadLineageGraph(input: unknown): LineageGraph {
  if (!isJsonObject(input)) throw new Error("lineage graph must be a JSON object");
  const graph = input as unknown as LineageGraph;
  if (graph.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!isNonEmptyString(graph.id)) throw new Error("id must be a non-empty string");
  if (!Array.isArray(graph.records)) throw new Error("records must be an array");
  for (const [index, record] of graph.records.entries()) validateRecord(record, `records[${index}]`);
  return {
    schemaVersion: 1,
    id: graph.id,
    records: [...graph.records].sort(compareRecords),
  };
}

export function recordLineage(graphInput: LineageGraph | unknown, options: RecordLineageOptions): LineageGraph {
  const graph = loadLineageGraph(graphInput);
  const root = resolve(options.root || process.cwd());
  if (!isNonEmptyString(options.artifact)) throw new Error("artifact must be a non-empty path");
  const artifact = snapshotRequired(root, options.artifact, options.kind);
  const inputs: LineageInput[] = [
    ...(options.inputs || []).map((input) => snapshotRequired(root, input)),
    ...(options.optionalInputs || []).map((input) => snapshotOptional(root, input)),
  ];
  const record: LineageRecord = {
    id: "",
    artifact,
    inputs: inputs.sort(compareSnapshots),
    ...(options.command ? { command: options.command } : {}),
    ...(options.now ? { createdAt: toIsoString(options.now) } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
  record.id = lineageRecordId(record);

  const records = graph.records.filter((item) => item.artifact.path !== record.artifact.path);
  records.push(record);
  records.sort(compareRecords);
  const updated: LineageGraph = { schemaVersion: 1, id: "", records };
  updated.id = lineageGraphId(updated);
  return updated;
}

export function checkLineage(graphInput: LineageGraph | unknown, options: CheckLineageOptions = {}): LineageCheckResult {
  const graph = loadLineageGraph(graphInput);
  const root = resolve(options.root || process.cwd());
  const wanted = options.artifact ? toStoredPath(root, options.artifact) : "";
  const checks = graph.records.map((record) => evaluateRecord(root, record));
  const byArtifact = new Map(checks.map((check) => [check.record.artifact.path, check]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const check of checks) {
      if (applyUpstreamIssues(check, byArtifact)) changed = true;
    }
  }
  const records = wanted ? checks.filter((check) => check.record.artifact.path === wanted) : checks;
  const issues = records.flatMap((record) => record.issues);
  const current = records.filter((record) => record.state === "current").length;
  const stale = records.filter((record) => record.state === "stale").length;
  const missing = records.filter((record) => record.state === "missing").length;
  if (wanted && records.length === 0) {
    issues.push(error("artifact-not-recorded", `${wanted} is not recorded`, wanted));
  }
  return {
    ok: issues.filter((issue) => issue.severity === "error").length === 0,
    graphId: graph.id,
    total: records.length,
    current,
    stale,
    missing,
    records,
    issues,
  };
}

export function verifyLineageGraph(input: unknown): LineageVerifyResult {
  const issues: LineageIssue[] = [];
  if (!isJsonObject(input)) return issueResult(error("invalid-graph", "lineage graph must be a JSON object"));
  const graph = input as unknown as LineageGraph;
  if (graph.schemaVersion !== 1) issues.push(error("invalid-schema", "schemaVersion must be 1"));
  if (!isNonEmptyString(graph.id)) issues.push(error("invalid-id", "id must be a non-empty string"));
  if (!Array.isArray(graph.records)) issues.push(error("invalid-records", "records must be an array"));
  if (Array.isArray(graph.records)) {
    const paths = new Set<string>();
    for (const [index, record] of graph.records.entries()) {
      verifyRecord(record, `records[${index}]`, issues);
      if (isJsonObject(record) && isJsonObject(record.artifact) && isNonEmptyString(record.artifact.path)) {
        if (paths.has(record.artifact.path)) issues.push(error("duplicate-artifact", `${record.artifact.path} is recorded more than once`, record.artifact.path));
        paths.add(record.artifact.path);
      }
      if (isJsonObject(record) && isNonEmptyString(record.id)) {
        const expected = lineageRecordId(record as unknown as LineageRecord);
        if (record.id !== expected) issues.push(error("record-id-mismatch", `record id mismatch; expected ${expected}`));
      }
    }
  }
  if (isNonEmptyString(graph.id)) {
    const expected = lineageGraphId(graph);
    if (graph.id !== expected) issues.push(error("graph-id-mismatch", `graph id mismatch; expected ${expected}`));
  }
  return issueResult(...issues);
}

export function lineageGraphId(graph: LineageGraph | Omit<LineageGraph, "id">): string {
  const payload = { ...(graph as LineageGraph), id: "" };
  return `lineage:${hashJson(toJsonValue(payload)).slice(0, 16)}`;
}

export function lineageRecordId(record: LineageRecord | Omit<LineageRecord, "id">): string {
  const payload = { ...(record as LineageRecord), id: "" };
  return `record:${hashJson(toJsonValue(payload)).slice(0, 16)}`;
}

function evaluateRecord(root: string, record: LineageRecord): LineageRecordCheck {
  const issues: LineageIssue[] = [];
  const artifact = currentSnapshot(root, record.artifact.path);
  if (!artifact) {
    issues.push(error("missing-artifact", `${record.artifact.path} is missing`, record.artifact.path));
  } else if (artifact.hash !== record.artifact.hash) {
    issues.push(error("artifact-hash-changed", `${record.artifact.path} hash changed`, record.artifact.path));
  }
  const inputs = record.inputs.map((input) => evaluateInput(root, record.artifact.path, input));
  issues.push(...inputs.flatMap((input) => input.issues));
  return {
    record,
    state: stateFor(issues),
    ...(artifact ? { artifact } : {}),
    inputs,
    issues,
  };
}

function evaluateInput(root: string, artifact: string, input: LineageInput): LineageInputCheck {
  const issues: LineageIssue[] = [];
  const current = currentSnapshot(root, input.path);
  if (input.missing) {
    if (current) {
      issues.push(error("optional-input-created", `${input.path} exists now but was missing when ${artifact} was recorded`, artifact, input.path));
    }
  } else if (!current) {
    issues.push(error("missing-input", `${input.path} is missing`, artifact, input.path));
  } else if (current.hash !== input.hash) {
    issues.push(error("input-hash-changed", `${input.path} hash changed`, artifact, input.path));
  }
  return {
    input,
    ...(current ? { current } : {}),
    state: stateFor(issues),
    issues,
  };
}

function applyUpstreamIssues(check: LineageRecordCheck, byArtifact: Map<string, LineageRecordCheck>): boolean {
  let changed = false;
  for (const input of check.record.inputs) {
    const upstream = byArtifact.get(input.path);
    if (!upstream || upstream === check || upstream.state === "current") continue;
    const issue = error("stale-upstream", `${check.record.artifact.path} depends on stale ${input.path}`, check.record.artifact.path, input.path);
    if (!check.issues.some((existing) => existing.code === issue.code && existing.input === issue.input)) {
      check.issues.push(issue);
      check.state = "stale";
      changed = true;
    }
  }
  return changed;
}

function stateFor(issues: LineageIssue[]): LineageRecordState {
  if (!issues.length) return "current";
  if (issues.some((issue) => issue.code === "missing-artifact")) return "missing";
  return "stale";
}

function snapshotRequired(root: string, path: string, kind?: string): LineageSnapshot {
  const snapshot = currentSnapshot(root, path, kind);
  if (!snapshot) throw new Error(`${toStoredPath(root, path)} does not exist`);
  return snapshot;
}

function snapshotOptional(root: string, path: string): LineageInput {
  return currentSnapshot(root, path) || { path: toStoredPath(root, path), optional: true, missing: true };
}

function currentSnapshot(root: string, path: string, kind?: string): LineageSnapshot | undefined {
  const abs = resolve(root, path);
  if (!existsSync(abs)) return undefined;
  const stat = statSync(abs);
  if (!stat.isFile()) throw new Error(`${toStoredPath(root, path)} is not a file`);
  const bytes = readFileSync(abs);
  return {
    path: toStoredPath(root, path),
    hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    size: stat.size,
    ...(kind ? { kind } : {}),
  };
}

function toStoredPath(root: string, path: string): string {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return normalizePath(rel);
  return normalizePath(abs);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("now must be a valid date");
  return date.toISOString();
}

function loadSnapshot(value: unknown, path: string, input = false): LineageSnapshot | LineageInput {
  if (!isJsonObject(value)) throw new Error(`${path} must be an object`);
  const snapshot = value as unknown as LineageSnapshot | LineageInput;
  if (!isNonEmptyString(snapshot.path)) throw new Error(`${path}.path must be a non-empty string`);
  if (snapshot.hash !== undefined && !isNonEmptyString(snapshot.hash)) throw new Error(`${path}.hash must be a non-empty string`);
  if (snapshot.size !== undefined && (!Number.isInteger(snapshot.size) || snapshot.size < 0)) throw new Error(`${path}.size must be a non-negative integer`);
  if (snapshot.kind !== undefined && !isNonEmptyString(snapshot.kind)) throw new Error(`${path}.kind must be a non-empty string`);
  if (snapshot.missing !== undefined && typeof snapshot.missing !== "boolean") throw new Error(`${path}.missing must be boolean`);
  if (snapshot.missing !== true && !isNonEmptyString(snapshot.hash)) throw new Error(`${path}.hash is required unless missing is true`);
  if (input) {
    const lineageInput = snapshot as LineageInput;
    if (lineageInput.optional !== undefined && typeof lineageInput.optional !== "boolean") throw new Error(`${path}.optional must be boolean`);
    if (lineageInput.role !== undefined && !isNonEmptyString(lineageInput.role)) throw new Error(`${path}.role must be a non-empty string`);
  }
  return snapshot;
}

function validateRecord(value: unknown, path: string): void {
  if (!isJsonObject(value)) throw new Error(`${path} must be an object`);
  const record = value as unknown as LineageRecord;
  if (!isNonEmptyString(record.id)) throw new Error(`${path}.id must be a non-empty string`);
  loadSnapshot(record.artifact, `${path}.artifact`);
  if (!Array.isArray(record.inputs)) throw new Error(`${path}.inputs must be an array`);
  for (const [index, input] of record.inputs.entries()) loadSnapshot(input, `${path}.inputs[${index}]`, true);
  if (record.command !== undefined && !isNonEmptyString(record.command)) throw new Error(`${path}.command must be a non-empty string`);
  if (record.createdAt !== undefined && Number.isNaN(new Date(record.createdAt).getTime())) throw new Error(`${path}.createdAt must be an ISO date`);
  if (record.metadata !== undefined && !isJsonObject(record.metadata)) throw new Error(`${path}.metadata must be an object`);
}

function verifyRecord(value: unknown, path: string, issues: LineageIssue[]): void {
  try {
    validateRecord(value, path);
  } catch (error) {
    issues.push(errorIssue("invalid-record", error instanceof Error ? error.message : String(error)));
  }
}

function compareRecords(a: LineageRecord, b: LineageRecord): number {
  return a.artifact.path.localeCompare(b.artifact.path);
}

function compareSnapshots(a: LineageSnapshot, b: LineageSnapshot): number {
  return a.path.localeCompare(b.path);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(toJsonValue(value))).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function error(code: string, message: string, artifact?: string, input?: string): LineageIssue {
  return { severity: "error", code, message, ...(artifact ? { artifact } : {}), ...(input ? { input } : {}) };
}

function errorIssue(code: string, message: string): LineageIssue {
  return { severity: "error", code, message };
}

function issueResult(...issues: LineageIssue[]): LineageVerifyResult {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return { ok: errors === 0, errors, warnings, issues };
}

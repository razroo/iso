import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { OPENCODE_SQLITE_FORMAT } from "./sources/opencode.js";
import type { Session, SessionRef, ToolCallEvent, ToolResultEvent, Turn } from "./types.js";

export interface ModelScorecardOptions {
  tool?: string;
  sinceMs?: number;
}

export interface ModelScore {
  model: string;
  sessions: number;
  calls: number;
  completed: number;
  errors: number;
  schemaErrors: number;
  successRate: number;
  latestAt: string;
  readInputShapes: {
    filePath: number;
    path: number;
    file_path: number;
    other: number;
  };
}

interface CallMeta {
  model: string;
  name: string;
}

interface ModelScoreAccum {
  model: string;
  sessionIds: Set<string>;
  calls: number;
  completed: number;
  errors: number;
  schemaErrors: number;
  latestAt: string;
  readInputShapes: ModelScore["readInputShapes"];
}

interface OpenCodeToolRow {
  session_id: string;
  time_created: number;
  providerID?: string | null;
  modelID?: string | null;
  tool?: string | null;
  status?: string | null;
  error?: string | null;
  filePath?: string | null;
  path?: string | null;
  file_path?: string | null;
}

export function modelScorecard(sessions: Session[], opts: ModelScorecardOptions = {}): ModelScore[] {
  const byModel = new Map<string, ModelScoreAccum>();

  for (const session of sessions) {
    const calls = new Map<string, CallMeta>();
    for (const turn of session.turns) {
      if (opts.sinceMs !== undefined && Date.parse(turn.at) < opts.sinceMs) continue;
      const turnModel = inferTurnModel(turn, session.model);
      for (const event of turn.events) {
        if (event.kind === "tool_call") {
          const call = event as ToolCallEvent;
          if (opts.tool && call.name !== opts.tool) continue;
          const acc = ensureAccum(byModel, turnModel);
          acc.sessionIds.add(session.id);
          if (turn.at > acc.latestAt) acc.latestAt = turn.at;
          acc.calls += 1;
          calls.set(call.id, { model: turnModel, name: call.name });
          if (call.name === "read") {
            acc.readInputShapes[shapeForReadInput(call.input)] += 1;
          }
          continue;
        }

        if (event.kind !== "tool_result") continue;
        const result = event as ToolResultEvent;
        const meta = calls.get(result.toolUseId);
        if (!meta) continue;
        const acc = ensureAccum(byModel, meta.model);
        if (result.error) {
          acc.errors += 1;
          if (looksLikeSchemaError(result.error)) acc.schemaErrors += 1;
        } else {
          acc.completed += 1;
        }
      }
    }
  }

  return finalizeScores(byModel);
}

export function modelScorecardFromRefs(
  refs: SessionRef[],
  loadSession: (ref: SessionRef) => Session,
  opts: ModelScorecardOptions = {},
): ModelScore[] {
  if (canUseOpenCodeFastPath(refs)) {
    return modelScorecardFromOpenCodeRows(queryOpenCodeToolRows(refs, opts.tool, opts.sinceMs), opts);
  }
  return modelScorecard(refs.map((ref) => loadSession(ref)), opts);
}

export function modelScorecardFromOpenCodeRows(
  rows: OpenCodeToolRow[],
  opts: ModelScorecardOptions = {},
): ModelScore[] {
  const byModel = new Map<string, ModelScoreAccum>();

  for (const row of rows) {
    if (opts.sinceMs !== undefined && row.time_created < opts.sinceMs) continue;
    if (opts.tool && row.tool !== opts.tool) continue;
    const model = formatModel(row.providerID, row.modelID);
    const acc = ensureAccum(byModel, model);
    acc.sessionIds.add(row.session_id);
    const at = msToIso(row.time_created);
    if (at > acc.latestAt) acc.latestAt = at;
    acc.calls += 1;

    if (row.tool === "read") {
      acc.readInputShapes[shapeForReadColumns(row)] += 1;
    }

    if (isOpenCodeToolError(row.status, row.error)) {
      acc.errors += 1;
      if (looksLikeSchemaError(row.error ?? "")) acc.schemaErrors += 1;
      continue;
    }

    acc.completed += 1;
  }

  return finalizeScores(byModel);
}

function ensureAccum(byModel: Map<string, ModelScoreAccum>, model: string): ModelScoreAccum {
  const key = model || "unknown";
  const existing = byModel.get(key);
  if (existing) return existing;
  const created: ModelScoreAccum = {
    model: key,
    sessionIds: new Set<string>(),
    calls: 0,
    completed: 0,
    errors: 0,
    schemaErrors: 0,
    latestAt: "",
    readInputShapes: { filePath: 0, path: 0, file_path: 0, other: 0 },
  };
  byModel.set(key, created);
  return created;
}

function inferTurnModel(turn: Turn, sessionModel: string | undefined): string {
  for (const event of turn.events) {
    if (event.kind === "token_usage" && event.model) return event.model;
  }
  return sessionModel ?? "unknown";
}

function finalizeScores(byModel: Map<string, ModelScoreAccum>): ModelScore[] {
  return [...byModel.values()]
    .map((acc) => ({
      model: acc.model,
      sessions: acc.sessionIds.size,
      calls: acc.calls,
      completed: acc.completed,
      errors: acc.errors,
      schemaErrors: acc.schemaErrors,
      successRate: acc.calls === 0 ? 0 : acc.completed / acc.calls,
      latestAt: acc.latestAt,
      readInputShapes: acc.readInputShapes,
    }))
    .filter((score) => score.calls > 0)
    .sort((a, b) => {
      if (b.calls !== a.calls) return b.calls - a.calls;
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return b.latestAt > a.latestAt ? 1 : b.latestAt < a.latestAt ? -1 : 0;
    });
}

function shapeForReadInput(input: unknown): keyof ModelScore["readInputShapes"] {
  if (!isRecord(input)) return "other";
  if (typeof input.filePath === "string" && input.filePath) return "filePath";
  if (typeof input.path === "string" && input.path) return "path";
  if (typeof input.file_path === "string" && input.file_path) return "file_path";
  return "other";
}

function shapeForReadColumns(row: OpenCodeToolRow): keyof ModelScore["readInputShapes"] {
  if (typeof row.filePath === "string" && row.filePath) return "filePath";
  if (typeof row.path === "string" && row.path) return "path";
  if (typeof row.file_path === "string" && row.file_path) return "file_path";
  return "other";
}

function looksLikeSchemaError(error: string): boolean {
  return /invalid arguments|invalid input|expected schema|received undefined|expected .* received/i.test(error);
}

function canUseOpenCodeFastPath(refs: SessionRef[]): boolean {
  return (
    refs.length > 0 &&
    refs.every(
      (ref) =>
        ref.source.harness === "opencode" &&
        ref.source.format === OPENCODE_SQLITE_FORMAT &&
        ref.source.path.includes("#session="),
    )
  );
}

function queryOpenCodeToolRows(refs: SessionRef[], tool?: string, sinceMs?: number): OpenCodeToolRow[] {
  const dbPath = sharedOpenCodeDbPath(refs);
  const sessionIds = refs.map((ref) => sessionIdFromLocator(ref.source.path));
  const sessionFilter = sessionIds.map(sqlString).join(", ");
  const toolClause = tool ? ` and json_extract(p.data, '$.tool') = ${sqlString(tool)}` : "";
  const sinceClause = sinceMs !== undefined ? ` and p.time_created >= ${sinceMs}` : "";
  const sql = [
    "select",
    "  p.session_id as session_id,",
    "  p.time_created as time_created,",
    "  json_extract(m.data, '$.providerID') as providerID,",
    "  json_extract(m.data, '$.modelID') as modelID,",
    "  json_extract(p.data, '$.tool') as tool,",
    "  json_extract(p.data, '$.state.status') as status,",
    "  coalesce(",
    "    json_extract(p.data, '$.state.error.data.message'),",
    "    json_extract(p.data, '$.state.error.message'),",
    "    json_extract(p.data, '$.state.error'),",
    "    json_extract(p.data, '$.state.output')",
    "  ) as error,",
    "  json_extract(p.data, '$.state.input.filePath') as filePath,",
    "  json_extract(p.data, '$.state.input.path') as path,",
    "  json_extract(p.data, '$.state.input.file_path') as file_path",
    "from part p",
    "join message m on m.id = p.message_id",
    "where p.session_id in (" + sessionFilter + ")",
    "  and json_extract(m.data, '$.role') = 'assistant'",
    "  and json_extract(p.data, '$.type') = 'tool'" + toolClause + sinceClause,
    "order by p.time_created asc",
  ].join(" ");
  return runSqliteJsonQuery(dbPath, sql);
}

function runSqliteJsonQuery(dbPath: string, sql: string): OpenCodeToolRow[] {
  const result = runSqliteQuery(dbPath, sql);
  if ((result.status ?? 0) !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    throw new Error(`iso-trace: sqlite3 query failed: ${detail}`);
  }
  const parsed = JSON.parse(result.stdout || "[]") as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`iso-trace: sqlite3 query returned non-array JSON`);
  }
  return parsed as OpenCodeToolRow[];
}

function runSqliteQuery(dbPath: string, sql: string): SpawnSyncReturns<string> {
  let lastResult: SpawnSyncReturns<string> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if ((result.status ?? 0) === 0) return result;
    lastResult = result;
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    if (!isRetryableSqliteError(detail)) return result;
  }
  return lastResult ?? spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sessionIdFromLocator(path: string): string {
  const match = path.match(/#session=([^#]+)$/);
  if (!match) throw new Error(`iso-trace: invalid OpenCode session locator "${path}"`);
  return decodeURIComponent(match[1]);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sharedOpenCodeDbPath(refs: SessionRef[]): string {
  const dbPaths = new Set(refs.map((ref) => dbPathFromLocator(ref.source.path)));
  if (dbPaths.size !== 1) {
    throw new Error(`iso-trace: OpenCode model scoring requires refs from one database`);
  }
  const [dbPath] = [...dbPaths];
  return dbPath;
}

function dbPathFromLocator(path: string): string {
  const index = path.indexOf("#session=");
  if (index === -1) throw new Error(`iso-trace: invalid OpenCode session locator "${path}"`);
  return path.slice(0, index);
}

function formatModel(providerID: string | null | undefined, modelID: string | null | undefined): string {
  const model = typeof modelID === "string" && modelID ? modelID : "";
  const provider = typeof providerID === "string" && providerID ? providerID : "";
  if (provider && model) return `${provider}/${model}`;
  return model || provider || "unknown";
}

function isOpenCodeToolError(status: string | null | undefined, error: string | null | undefined): boolean {
  const value = typeof status === "string" ? status.toLowerCase() : "";
  if (value === "error" || value === "failed") return true;
  return !value && typeof error === "string" && !!error.trim();
}

function isRetryableSqliteError(detail: string): boolean {
  return /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(detail);
}

function msToIso(value: number): string {
  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentmdAdherenceCheck, CheckResult } from "../types.js";

/**
 * Subprocess runner contract used by the agentmd_adherence check. Tests
 * inject a fake so they don't have to shell out to a real agentmd binary
 * with a real API key attached.
 */
export type AgentmdSpawnFn = (
  args: string[],
  opts: { cwd: string; timeoutMs?: number },
) => SpawnSyncReturns<string>;

const defaultSpawn: AgentmdSpawnFn = (args, opts) => {
  const bin = resolveAgentmdBin();
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    timeout: opts.timeoutMs,
  });
};

// Resolve the agentmd CLI bin via node resolution so it works regardless of
// shell PATH. Requires @razroo/agentmd to be an iso-eval dependency.
function resolveAgentmdBin(): string {
  const req = createRequire(import.meta.url);
  const pkgJsonPath = req.resolve("@razroo/agentmd/package.json");
  const pkg = req(pkgJsonPath) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.agentmd;
  if (!bin) {
    throw new Error(
      `@razroo/agentmd is installed but has no "agentmd" bin entry — update the dependency.`,
    );
  }
  return resolve(dirname(pkgJsonPath), bin);
}

interface AgentmdCheckRecord {
  rule: string;
  passed: boolean;
}

interface AgentmdTrial {
  checks?: AgentmdCheckRecord[];
}

interface AgentmdCase {
  name: string;
  trials?: AgentmdTrial[];
}

interface AgentmdRunResult {
  agent?: string;
  cases?: AgentmdCase[];
}

export interface RunAgentmdAdherenceOptions {
  /** Directory that `promptFile` / `fixtures` paths are resolved against. */
  suiteDir: string;
  /** Optional injected spawn fn for tests. Defaults to real `agentmd` subprocess. */
  spawn?: AgentmdSpawnFn;
}

export async function runAgentmdAdherence(
  check: AgentmdAdherenceCheck,
  opts: RunAgentmdAdherenceOptions,
): Promise<CheckResult> {
  const promptFile = resolvePath(check.promptFile, opts.suiteDir);
  const fixtures = resolvePath(check.fixtures, opts.suiteDir);

  if (!existsSync(promptFile)) {
    return fail(check, `promptFile not found: ${promptFile}`);
  }
  if (!existsSync(fixtures)) {
    return fail(check, `fixtures not found: ${fixtures}`);
  }

  const args: string[] = ["test", promptFile, "--fixtures", fixtures, "--format", "json"];
  if (check.via) args.push("--via", check.via);
  if (check.model) args.push("--model", check.model);

  const run = (opts.spawn ?? defaultSpawn)(args, {
    cwd: opts.suiteDir,
    timeoutMs: check.timeoutMs,
  });

  if (run.error) {
    return fail(check, `agentmd subprocess failed: ${run.error.message}`);
  }
  if (run.status !== 0) {
    const stderr = (run.stderr ?? "").trim();
    return fail(
      check,
      `agentmd exited ${run.status ?? "null"}${stderr ? ` — ${shorten(stderr, 200)}` : ""}`,
    );
  }

  let parsed: AgentmdRunResult;
  try {
    parsed = JSON.parse(run.stdout ?? "") as AgentmdRunResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(check, `agentmd output was not valid JSON: ${msg}`);
  }

  const totals = adherenceTotals(parsed, check.ruleId);
  if (totals.total === 0) {
    return fail(
      check,
      check.ruleId
        ? `no checks found for rule "${check.ruleId}" in agentmd output`
        : "agentmd produced 0 per-rule checks — nothing to score",
    );
  }
  const passRate = totals.passed / totals.total;
  const min = check.minPassRate;
  const passed = passRate >= min;
  const scope = check.ruleId ? `rule ${check.ruleId}` : "all rules";
  const pct = (passRate * 100).toFixed(1);
  const threshold = (min * 100).toFixed(1);
  const detail = passed
    ? `${scope}: ${totals.passed}/${totals.total} pass (${pct}% ≥ ${threshold}%)`
    : `${scope}: ${totals.passed}/${totals.total} pass (${pct}% < ${threshold}%)`;
  return { check, passed, detail };
}

function resolvePath(p: string, suiteDir: string): string {
  return isAbsolute(p) ? p : resolve(suiteDir, p);
}

function adherenceTotals(
  result: AgentmdRunResult,
  ruleId?: string,
): { passed: number; total: number } {
  let passed = 0;
  let total = 0;
  for (const c of result.cases ?? []) {
    for (const t of c.trials ?? []) {
      for (const ck of t.checks ?? []) {
        if (ruleId && ck.rule !== ruleId) continue;
        total += 1;
        if (ck.passed) passed += 1;
      }
    }
  }
  return { passed, total };
}

function fail(check: AgentmdAdherenceCheck, reason: string): CheckResult {
  return { check, passed: false, detail: reason };
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

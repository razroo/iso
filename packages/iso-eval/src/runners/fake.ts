import { spawnSync } from "node:child_process";
import type { RunnerContext, RunnerFn, RunnerResult } from "../types.js";

// Deterministic runner used for tests and CI smoke. Scans the task prompt
// for lines beginning with "$ " and executes them in the snapshotted
// workspace. No model, no network — a stand-in for a real coding agent
// so the orchestration layer can be exercised offline.
export const fakeRunner: RunnerFn = async (
  ctx: RunnerContext,
): Promise<RunnerResult> => {
  const start = Date.now();
  const lines = ctx.taskPrompt.split(/\r?\n/);
  const commands = lines
    .map((line) => line.match(/^\$\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for (const cmd of commands) {
    const r = spawnSync("sh", ["-c", cmd], {
      cwd: ctx.workspaceDir,
      encoding: "utf8",
      timeout: ctx.timeoutMs,
    });
    if (r.stdout) stdout += r.stdout;
    if (r.stderr) stderr += r.stderr;
    if ((r.status ?? 0) !== 0) {
      exitCode = r.status ?? 1;
      break;
    }
  }

  return { exitCode, stdout, stderr, durationMs: Date.now() - start };
};

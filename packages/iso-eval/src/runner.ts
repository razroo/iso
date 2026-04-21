import { runCheck } from "./checks/index.js";
import type { AgentmdSpawnFn } from "./checks/agentmd-adherence.js";
import { snapshotWorkspace } from "./sandbox.js";
import type {
  CheckResult,
  EvalReport,
  JudgeFn,
  RunnerFn,
  Suite,
  Task,
  TaskResult,
  TrialResult,
} from "./types.js";

export interface RunOptions {
  runner: RunnerFn;
  judge?: JudgeFn;
  concurrency?: number;
  filter?: (taskId: string) => boolean;
  keepWorkspaces?: boolean;
  onTaskComplete?: (result: TaskResult) => void;
  timestamp?: string;
  /** Optional: injected spawn fn used by the agentmd_adherence check. Lets tests avoid a real subprocess. */
  agentmdSpawn?: AgentmdSpawnFn;
}

export async function run(suite: Suite, opts: RunOptions): Promise<EvalReport> {
  const start = Date.now();
  const tasks = opts.filter ? suite.tasks.filter((t) => opts.filter!(t.id)) : suite.tasks;
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const results: TaskResult[] = new Array(tasks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      const result = await runTask(tasks[i], suite, opts);
      results[i] = result;
      opts.onTaskComplete?.(result);
    }
  };
  const parallel = Math.min(concurrency, Math.max(tasks.length, 1));
  await Promise.all(Array.from({ length: parallel }, worker));

  const passed = results.every((t) => t.passed);
  return {
    suite: suite.name,
    runner: suite.runner,
    tasks: results,
    passed,
    durationMs: Date.now() - start,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  };
}

async function runTask(
  task: Task,
  suite: Suite,
  opts: RunOptions,
): Promise<TaskResult> {
  const trials: TrialResult[] = [];
  for (let t = 0; t < task.trials; t++) {
    const snap = snapshotWorkspace(task.workspace, task.id);
    try {
      const runnerResult = await opts.runner({
        workspaceDir: snap.dir,
        taskPrompt: task.prompt,
        timeoutMs: suite.timeoutMs,
        harnessSource: suite.harnessSource,
      });
      const checks: CheckResult[] = [];
      for (const c of task.checks) {
        const r = await runCheck(c, {
          workspaceDir: snap.dir,
          runnerResult,
          judge: opts.judge,
          suiteDir: suite.sourceDir,
          agentmdSpawn: opts.agentmdSpawn,
        });
        checks.push(r);
      }
      const passed = checks.length > 0 && checks.every((c) => c.passed);
      trials.push({ runner: runnerResult, checks, passed });
    } finally {
      if (!opts.keepWorkspaces) snap.cleanup();
    }
  }
  const passed = trials.length > 0 && trials.every((t) => t.passed);
  return { id: task.id, trials, passed };
}

import type {
  CheckResult,
  JudgeFn,
  LlmJudgeCheck,
  RunnerResult,
} from "../types.js";

export async function runLlmJudge(
  check: LlmJudgeCheck,
  runnerResult: RunnerResult,
  judge: JudgeFn | undefined,
): Promise<CheckResult> {
  if (!judge) {
    return {
      check,
      passed: false,
      detail:
        "llm_judge requires a judge function — pass opts.judge to run() or use a different check type",
    };
  }
  const output = [runnerResult.stdout, runnerResult.stderr]
    .filter(Boolean)
    .join("\n---\n");
  try {
    const passed = await judge(check.prompt, output);
    return { check, passed, detail: passed ? "judge: yes" : "judge: no" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { check, passed: false, detail: `judge error: ${msg}` };
  }
}

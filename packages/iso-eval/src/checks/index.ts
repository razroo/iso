import type { Check, CheckResult, JudgeFn, RunnerResult } from "../types.js";
import { runCommandCheck } from "./command.js";
import {
  runFileContains,
  runFileExists,
  runFileMatches,
  runFileNotContains,
} from "./file.js";
import { runLlmJudge } from "./llm_judge.js";

export interface CheckContext {
  workspaceDir: string;
  runnerResult: RunnerResult;
  judge?: JudgeFn;
}

export async function runCheck(
  check: Check,
  ctx: CheckContext,
): Promise<CheckResult> {
  switch (check.type) {
    case "command":
      return runCommandCheck(check, ctx.workspaceDir);
    case "file_exists":
      return runFileExists(check, ctx.workspaceDir);
    case "file_contains":
      return runFileContains(check, ctx.workspaceDir);
    case "file_not_contains":
      return runFileNotContains(check, ctx.workspaceDir);
    case "file_matches":
      return runFileMatches(check, ctx.workspaceDir);
    case "llm_judge":
      return runLlmJudge(check, ctx.runnerResult, ctx.judge);
    default: {
      const exhaustive: never = check;
      throw new Error(`unhandled check type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

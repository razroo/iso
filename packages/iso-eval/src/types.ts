export interface CommandCheck {
  type: "command";
  run: string;
  expectExit?: number;
  expectStdoutContains?: string;
  expectStdoutMatches?: string;
  timeoutMs?: number;
}

export interface FileExistsCheck {
  type: "file_exists";
  path: string;
}

export interface FileMatchesCheck {
  type: "file_matches";
  path: string;
  matches: string;
}

export interface FileContainsCheck {
  type: "file_contains";
  path: string;
  value: string;
}

export interface FileNotContainsCheck {
  type: "file_not_contains";
  path: string;
  value: string;
}

export interface LlmJudgeCheck {
  type: "llm_judge";
  prompt: string;
}

export type Check =
  | CommandCheck
  | FileExistsCheck
  | FileMatchesCheck
  | FileContainsCheck
  | FileNotContainsCheck
  | LlmJudgeCheck;

export type RunnerName = "fake";

export interface Task {
  id: string;
  prompt: string;
  promptPath?: string;
  workspace: string;
  trials: number;
  checks: Check[];
}

export interface Suite {
  name: string;
  runner: RunnerName;
  timeoutMs?: number;
  harnessSource?: string;
  tasks: Task[];
  sourcePath: string;
  sourceDir: string;
}

export interface RunnerContext {
  workspaceDir: string;
  taskPrompt: string;
  timeoutMs?: number;
}

export interface RunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type RunnerFn = (ctx: RunnerContext) => Promise<RunnerResult>;

export type JudgeFn = (prompt: string, output: string) => Promise<boolean>;

export interface CheckResult {
  check: Check;
  passed: boolean;
  detail: string;
}

export interface TrialResult {
  runner: RunnerResult;
  checks: CheckResult[];
  passed: boolean;
}

export interface TaskResult {
  id: string;
  trials: TrialResult[];
  passed: boolean;
}

export interface EvalReport {
  suite: string;
  runner: RunnerName;
  tasks: TaskResult[];
  passed: boolean;
  durationMs: number;
  timestamp: string;
}

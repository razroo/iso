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

/**
 * Score per-rule adherence of an agentmd-dialect prompt against a fixture
 * file by shelling out to `agentmd test --format json`. Fails the check when
 * the pass rate for the named rule (or overall, if `ruleId` is omitted) is
 * below `minPassRate`.
 */
export interface AgentmdAdherenceCheck {
  type: "agentmd_adherence";
  /** Path to the agentmd source file (agent.md). Resolved relative to the eval.yml. */
  promptFile: string;
  /** Path to the fixture YAML. Resolved relative to the eval.yml. */
  fixtures: string;
  /** Optional: only score this rule ID (e.g. "H3"). */
  ruleId?: string;
  /** Minimum pass rate in [0, 1] for the check to succeed. */
  minPassRate: number;
  /** Optional: passed through as `agentmd test --via <name>`. Default: "claude-code". */
  via?: "api" | "claude-code" | "fake";
  /** Optional: passed through as `agentmd test --model <id>`. */
  model?: string;
  /** Optional: subprocess timeout in ms. */
  timeoutMs?: number;
}

export type Check =
  | CommandCheck
  | FileExistsCheck
  | FileMatchesCheck
  | FileContainsCheck
  | FileNotContainsCheck
  | LlmJudgeCheck
  | AgentmdAdherenceCheck;

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

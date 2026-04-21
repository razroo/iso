import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import type { Check, RunnerName, Suite, Task } from "./types.js";

const VALID_RUNNERS: ReadonlySet<RunnerName> = new Set<RunnerName>(["fake", "codex"]);

const VALID_CHECK_TYPES: ReadonlySet<Check["type"]> = new Set<Check["type"]>([
  "command",
  "file_exists",
  "file_matches",
  "file_contains",
  "file_not_contains",
  "llm_judge",
  "agentmd_adherence",
]);

export function loadSuite(path: string): Suite {
  const sourcePath = resolve(path);
  const sourceDir = dirname(sourcePath);
  const raw = readFileSync(sourcePath, "utf8");
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: eval file must be a YAML object`);
  }
  const name = parsed.suite;
  if (typeof name !== "string" || !name) {
    throw new Error(`${path}: "suite" (non-empty string) is required`);
  }
  const runnerRaw = parsed.runner;
  if (typeof runnerRaw !== "string" || !VALID_RUNNERS.has(runnerRaw as RunnerName)) {
    throw new Error(
      `${path}: "runner" must be one of: ${[...VALID_RUNNERS].join(", ")} — got "${runnerRaw}"`,
    );
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error(`${path}: "tasks" must be a non-empty array`);
  }
  const tasks: Task[] = parsed.tasks.map((t: unknown, i: number) =>
    parseTask(t, i, sourceDir, path),
  );
  const seenIds = new Set<string>();
  for (const t of tasks) {
    if (seenIds.has(t.id)) {
      throw new Error(`${path}: duplicate task id "${t.id}" — each task must have a unique id`);
    }
    seenIds.add(t.id);
  }
  const timeoutMs =
    typeof parsed.timeoutMs === "number" && parsed.timeoutMs > 0 ? parsed.timeoutMs : undefined;
  const harnessSource =
    parsed.harness && typeof parsed.harness === "object" && typeof parsed.harness.source === "string"
      ? resolveRelative(parsed.harness.source, sourceDir)
      : undefined;
  return {
    name,
    runner: runnerRaw as RunnerName,
    timeoutMs,
    harnessSource,
    tasks,
    sourcePath,
    sourceDir,
  };
}

function parseTask(raw: unknown, i: number, sourceDir: string, evalPath: string): Task {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${evalPath}: task #${i + 1} must be an object`);
  }
  const t = raw as Record<string, unknown>;
  const id = t.id;
  if (typeof id !== "string" || !id) {
    throw new Error(`${evalPath}: task #${i + 1} missing required "id" (non-empty string)`);
  }
  const promptValue = t.prompt;
  if (typeof promptValue !== "string" || !promptValue) {
    throw new Error(`${evalPath}: task "${id}" missing required "prompt" (string)`);
  }
  const workspace = t.workspace;
  if (typeof workspace !== "string" || !workspace) {
    throw new Error(`${evalPath}: task "${id}" missing required "workspace" (path string)`);
  }
  if (!Array.isArray(t.checks)) {
    throw new Error(`${evalPath}: task "${id}" must have "checks" array (may be empty)`);
  }

  const { text: prompt, path: promptPath } = loadPromptText(promptValue, sourceDir);
  const trialsRaw = t.trials;
  const trials =
    typeof trialsRaw === "number" && Number.isInteger(trialsRaw) && trialsRaw > 0 ? trialsRaw : 1;
  const checks = t.checks.map((c: unknown, j: number) => parseCheck(c, id, j, evalPath));
  const task: Task = {
    id,
    prompt,
    workspace: resolveRelative(workspace, sourceDir),
    trials,
    checks,
  };
  if (promptPath) task.promptPath = promptPath;
  return task;
}

function loadPromptText(value: string, sourceDir: string): { text: string; path?: string } {
  if (value.includes("\n")) return { text: value };
  const candidate = resolveRelative(value, sourceDir);
  if (existsSync(candidate)) {
    return { text: readFileSync(candidate, "utf8"), path: candidate };
  }
  return { text: value };
}

function parseCheck(raw: unknown, taskId: string, i: number, evalPath: string): Check {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${evalPath}: task "${taskId}" check #${i + 1} must be an object`);
  }
  const c = raw as Record<string, unknown>;
  const t = c.type;
  if (typeof t !== "string" || !VALID_CHECK_TYPES.has(t as Check["type"])) {
    throw new Error(
      `${evalPath}: task "${taskId}" check #${i + 1}: unknown or missing type "${t}" ` +
        `(valid: ${[...VALID_CHECK_TYPES].join(", ")})`,
    );
  }
  if (t === "agentmd_adherence") {
    validateAgentmdAdherence(c, taskId, i, evalPath);
  }
  return c as unknown as Check;
}

function validateAgentmdAdherence(
  c: Record<string, unknown>,
  taskId: string,
  i: number,
  evalPath: string,
): void {
  const where = `${evalPath}: task "${taskId}" check #${i + 1} (agentmd_adherence)`;
  if (typeof c.promptFile !== "string" || !c.promptFile) {
    throw new Error(`${where}: "promptFile" (non-empty string) is required`);
  }
  if (typeof c.fixtures !== "string" || !c.fixtures) {
    throw new Error(`${where}: "fixtures" (non-empty string) is required`);
  }
  if (typeof c.minPassRate !== "number" || c.minPassRate < 0 || c.minPassRate > 1) {
    throw new Error(`${where}: "minPassRate" (number in [0, 1]) is required`);
  }
  if (c.ruleId !== undefined && (typeof c.ruleId !== "string" || !c.ruleId)) {
    throw new Error(`${where}: "ruleId" must be a non-empty string if present`);
  }
  if (c.via !== undefined && !["api", "claude-code", "fake"].includes(c.via as string)) {
    throw new Error(`${where}: "via" must be one of: api, claude-code, fake`);
  }
}

function resolveRelative(p: string, sourceDir: string): string {
  return isAbsolute(p) ? p : resolve(sourceDir, p);
}

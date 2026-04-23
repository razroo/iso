import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { RunnerContext, RunnerFn, RunnerResult } from "../types.js";
import { copyDir, copyFile, normaliseExitCode, type SyncSpawnResult } from "./shared.js";

export interface OpenCodeRunnerOptions {
  agent?: string;
  attach?: string;
  binary?: string;
  extraArgs?: string[];
  model?: string;
  pure?: boolean;
  spawn?: OpenCodeSpawnFn;
  variant?: string;
}

export interface OpenCodeSpawnContext {
  workspaceDir: string;
  taskPrompt: string;
  timeoutMs?: number;
  binary: string;
  args: string[];
}

export type OpenCodeSpawnFn = (ctx: OpenCodeSpawnContext) => SyncSpawnResult;

export function makeOpenCodeRunner(opts: OpenCodeRunnerOptions = {}): RunnerFn {
  const binary = opts.binary ?? "opencode";
  const spawn = opts.spawn ?? spawnOpenCode;

  return async (ctx: RunnerContext): Promise<RunnerResult> => {
    const start = Date.now();
    stageOpenCodeHarness(ctx.workspaceDir, ctx.harnessSource);

    const args = [
      "run",
      "--format",
      "default",
      "--dir",
      ctx.workspaceDir,
      "--dangerously-skip-permissions",
    ];
    if (opts.pure ?? true) args.push("--pure");
    if (opts.model) args.push("--model", opts.model);
    if (opts.agent) args.push("--agent", opts.agent);
    if (opts.attach) args.push("--attach", opts.attach);
    if (opts.variant) args.push("--variant", opts.variant);
    if (opts.extraArgs?.length) args.push(...opts.extraArgs);
    args.push(ctx.taskPrompt);

    const result = spawn({
      workspaceDir: ctx.workspaceDir,
      taskPrompt: ctx.taskPrompt,
      timeoutMs: ctx.timeoutMs,
      binary,
      args,
    });

    return {
      exitCode: normaliseExitCode(result),
      stdout: result.stdout?.trimEnd() ?? "",
      stderr: result.stderr ?? "",
      durationMs: Date.now() - start,
    };
  };
}

export const opencodeRunner: RunnerFn = makeOpenCodeRunner();

function spawnOpenCode(ctx: OpenCodeSpawnContext): SyncSpawnResult {
  return spawnSync(ctx.binary, ctx.args, {
    cwd: ctx.workspaceDir,
    encoding: "utf8",
    timeout: ctx.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function stageOpenCodeHarness(workspaceDir: string, harnessSource?: string): void {
  if (!harnessSource) return;
  const source = resolve(harnessSource);
  if (!existsSync(source)) {
    throw new Error(`harness source does not exist: ${source}`);
  }

  const st = statSync(source);
  if (st.isDirectory()) {
    let copied = false;
    const agents = join(source, "AGENTS.md");
    if (existsSync(agents)) {
      copyFile(agents, join(workspaceDir, "AGENTS.md"));
      copied = true;
    }
    const config = join(source, "opencode.json");
    if (existsSync(config)) {
      copyFile(config, join(workspaceDir, "opencode.json"));
      copied = true;
    }
    const opencodeDir = join(source, ".opencode");
    if (existsSync(opencodeDir) && statSync(opencodeDir).isDirectory()) {
      copyDir(opencodeDir, join(workspaceDir, ".opencode"));
      copied = true;
    }
    if (!copied) {
      throw new Error(
        `harness source ${source} does not contain OpenCode harness files (expected AGENTS.md, opencode.json, and/or .opencode/)`,
      );
    }
    return;
  }

  const name = basename(source);
  if (name === "AGENTS.md") {
    copyFile(source, join(workspaceDir, "AGENTS.md"));
    return;
  }
  if (name === "opencode.json") {
    copyFile(source, join(workspaceDir, "opencode.json"));
    return;
  }
  if (name === ".opencode") {
    copyDir(source, join(workspaceDir, ".opencode"));
    return;
  }
  throw new Error(
    `unsupported OpenCode harness source: ${source} (use a project dir, AGENTS.md, opencode.json, or .opencode/)`,
  );
}

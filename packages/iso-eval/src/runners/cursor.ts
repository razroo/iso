import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { RunnerContext, RunnerFn, RunnerResult } from "../types.js";
import { copyDir, copyFile, normaliseExitCode, type SyncSpawnResult } from "./shared.js";

export interface CursorRunnerOptions {
  approveMcps?: boolean;
  binary?: string;
  extraArgs?: string[];
  force?: boolean;
  mode?: "ask" | "plan";
  model?: string;
  sandbox?: "enabled" | "disabled";
  spawn?: CursorSpawnFn;
  trust?: boolean;
}

export interface CursorSpawnContext {
  workspaceDir: string;
  taskPrompt: string;
  timeoutMs?: number;
  binary: string;
  args: string[];
}

export type CursorSpawnFn = (ctx: CursorSpawnContext) => SyncSpawnResult;

export function makeCursorRunner(opts: CursorRunnerOptions = {}): RunnerFn {
  const binary = opts.binary ?? "cursor-agent";
  const spawn = opts.spawn ?? spawnCursor;

  return async (ctx: RunnerContext): Promise<RunnerResult> => {
    const start = Date.now();
    stageCursorHarness(ctx.workspaceDir, ctx.harnessSource);

    const args = ["--print", "--output-format", "text", "--workspace", ctx.workspaceDir];
    if (opts.force ?? true) args.push("--force");
    if (opts.trust ?? true) args.push("--trust");
    if (opts.approveMcps ?? true) args.push("--approve-mcps");
    if (opts.mode) args.push("--mode", opts.mode);
    if (opts.model) args.push("--model", opts.model);
    if (opts.sandbox) args.push("--sandbox", opts.sandbox);
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

export const cursorRunner: RunnerFn = makeCursorRunner();

function spawnCursor(ctx: CursorSpawnContext): SyncSpawnResult {
  return spawnSync(ctx.binary, ctx.args, {
    cwd: ctx.workspaceDir,
    encoding: "utf8",
    timeout: ctx.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function stageCursorHarness(workspaceDir: string, harnessSource?: string): void {
  if (!harnessSource) return;
  const source = resolve(harnessSource);
  if (!existsSync(source)) {
    throw new Error(`harness source does not exist: ${source}`);
  }

  const st = statSync(source);
  if (st.isDirectory()) {
    if (basename(source) === ".cursor") {
      copyDir(source, join(workspaceDir, ".cursor"));
      return;
    }
    if (basename(source) === "rules" && basename(dirname(source)) === ".cursor") {
      copyDir(source, join(workspaceDir, ".cursor", "rules"));
      return;
    }

    let copied = false;
    const cursorDir = join(source, ".cursor");
    if (existsSync(cursorDir) && statSync(cursorDir).isDirectory()) {
      copyDir(cursorDir, join(workspaceDir, ".cursor"));
      copied = true;
    }
    for (const rootRule of ["AGENTS.md", "CLAUDE.md"]) {
      const candidate = join(source, rootRule);
      if (existsSync(candidate)) {
        copyFile(candidate, join(workspaceDir, rootRule));
        copied = true;
      }
    }
    if (!copied) {
      throw new Error(
        `harness source ${source} does not contain Cursor harness files (expected .cursor/, .cursor/rules/, AGENTS.md, and/or CLAUDE.md)`,
      );
    }
    return;
  }

  const name = basename(source);
  if (name === "AGENTS.md" || name === "CLAUDE.md") {
    copyFile(source, join(workspaceDir, name));
    return;
  }
  if (name === "mcp.json" && basename(dirname(source)) === ".cursor") {
    copyFile(source, join(workspaceDir, ".cursor", "mcp.json"));
    return;
  }
  if (name.endsWith(".mdc") && basename(dirname(source)) === "rules" && basename(dirname(dirname(source))) === ".cursor") {
    copyFile(source, join(workspaceDir, ".cursor", "rules", name));
    return;
  }
  throw new Error(
    `unsupported Cursor harness source: ${source} (use a project dir, .cursor/, .cursor/rules/, .cursor/rules/*.mdc, .cursor/mcp.json, AGENTS.md, or CLAUDE.md)`,
  );
}

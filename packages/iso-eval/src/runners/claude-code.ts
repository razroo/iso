import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { RunnerContext, RunnerFn, RunnerResult } from "../types.js";
import { copyDir, copyFile, normaliseExitCode, type SyncSpawnResult } from "./shared.js";

export interface ClaudeCodeRunnerOptions {
  binary?: string;
  extraArgs?: string[];
  model?: string;
  permissionMode?: "acceptEdits" | "bypassPermissions";
  settingSources?: string;
  spawn?: ClaudeCodeSpawnFn;
}

export interface ClaudeCodeSpawnContext {
  workspaceDir: string;
  taskPrompt: string;
  timeoutMs?: number;
  binary: string;
  args: string[];
}

export type ClaudeCodeSpawnFn = (ctx: ClaudeCodeSpawnContext) => SyncSpawnResult;

export function makeClaudeCodeRunner(opts: ClaudeCodeRunnerOptions = {}): RunnerFn {
  const binary = opts.binary ?? "claude";
  const spawn = opts.spawn ?? spawnClaudeCode;
  const permissionMode = opts.permissionMode ?? "bypassPermissions";
  const settingSources = opts.settingSources ?? "project,local";

  return async (ctx: RunnerContext): Promise<RunnerResult> => {
    const start = Date.now();
    stageClaudeHarness(ctx.workspaceDir, ctx.harnessSource);

    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format",
      "text",
      "--permission-mode",
      permissionMode,
      "--setting-sources",
      settingSources,
    ];
    const mcp = join(ctx.workspaceDir, ".mcp.json");
    if (existsSync(mcp)) {
      args.push("--strict-mcp-config", "--mcp-config", mcp);
    }
    if (opts.model) args.push("--model", opts.model);
    if (opts.extraArgs?.length) args.push(...opts.extraArgs);

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

export const claudeCodeRunner: RunnerFn = makeClaudeCodeRunner();

function spawnClaudeCode(ctx: ClaudeCodeSpawnContext): SyncSpawnResult {
  return spawnSync(ctx.binary, ctx.args, {
    cwd: ctx.workspaceDir,
    encoding: "utf8",
    input: ctx.taskPrompt,
    timeout: ctx.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function stageClaudeHarness(workspaceDir: string, harnessSource?: string): void {
  if (!harnessSource) return;
  const source = resolve(harnessSource);
  if (!existsSync(source)) {
    throw new Error(`harness source does not exist: ${source}`);
  }

  const st = statSync(source);
  if (st.isDirectory()) {
    let copied = false;
    const prompt = join(source, "CLAUDE.md");
    if (existsSync(prompt)) {
      copyFile(prompt, join(workspaceDir, "CLAUDE.md"));
      copied = true;
    }
    const claudeDir = join(source, ".claude");
    if (existsSync(claudeDir) && statSync(claudeDir).isDirectory()) {
      copyDir(claudeDir, join(workspaceDir, ".claude"));
      copied = true;
    }
    const mcp = join(source, ".mcp.json");
    if (existsSync(mcp)) {
      copyFile(mcp, join(workspaceDir, ".mcp.json"));
      copied = true;
    }
    if (!copied) {
      throw new Error(
        `harness source ${source} does not contain Claude Code harness files (expected CLAUDE.md, .claude/, and/or .mcp.json)`,
      );
    }
    return;
  }

  const name = basename(source);
  if (name === "CLAUDE.md") {
    copyFile(source, join(workspaceDir, "CLAUDE.md"));
    return;
  }
  if (name === ".mcp.json") {
    copyFile(source, join(workspaceDir, ".mcp.json"));
    return;
  }
  if (name === ".claude") {
    copyDir(source, join(workspaceDir, ".claude"));
    return;
  }
  if (name === "settings.json" && basename(dirname(source)) === ".claude") {
    copyFile(source, join(workspaceDir, ".claude", "settings.json"));
    return;
  }
  throw new Error(
    `unsupported Claude Code harness source: ${source} (use a project dir, CLAUDE.md, .mcp.json, .claude/, or .claude/settings.json)`,
  );
}

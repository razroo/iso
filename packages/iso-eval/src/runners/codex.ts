import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { RunnerContext, RunnerFn, RunnerResult } from "../types.js";
import { normaliseExitCode } from "./shared.js";

interface CodexSpawnContext {
  workspaceDir: string;
  taskPrompt: string;
  timeoutMs?: number;
  outputFile: string;
}

type CodexSpawnResult = Pick<SpawnSyncReturns<string>, "status" | "signal" | "stdout" | "stderr" | "error">;

export type CodexSpawnFn = (ctx: CodexSpawnContext) => CodexSpawnResult;

export function makeCodexRunner(opts: { spawn?: CodexSpawnFn } = {}): RunnerFn {
  const spawn = opts.spawn ?? spawnCodex;
  return async (ctx: RunnerContext): Promise<RunnerResult> => {
    const start = Date.now();
    stageCodexHarness(ctx.workspaceDir, ctx.harnessSource);

    const outputDir = mkdtempSync(join(tmpdir(), "iso-eval-codex-"));
    const outputFile = join(outputDir, "last-message.txt");
    try {
      const result = spawn({
        workspaceDir: ctx.workspaceDir,
        taskPrompt: ctx.taskPrompt,
        timeoutMs: ctx.timeoutMs,
        outputFile,
      });

      const stdout = readLastMessage(outputFile, result.stdout);
      const stderr = result.stderr ?? "";
      const exitCode = normaliseExitCode(result);
      return {
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      };
    } finally {
      // Best-effort cleanup only; leaving a tmp file behind is not worth failing the eval.
      try {
        rmSync(outputDir, { recursive: true, force: true });
      } catch {
        // noop
      }
    }
  };
}

export const codexRunner: RunnerFn = makeCodexRunner();

function spawnCodex(ctx: CodexSpawnContext): CodexSpawnResult {
  return spawnSync(
    "codex",
    [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--full-auto",
      "-C",
      ctx.workspaceDir,
      "--output-last-message",
      ctx.outputFile,
      "-",
    ],
    {
      cwd: ctx.workspaceDir,
      encoding: "utf8",
      input: ctx.taskPrompt,
      timeout: ctx.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

function stageCodexHarness(workspaceDir: string, harnessSource?: string): void {
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
    const codexDir = join(source, ".codex");
    if (existsSync(codexDir) && statSync(codexDir).isDirectory()) {
      copyDir(codexDir, join(workspaceDir, ".codex"));
      copied = true;
    }
    if (!copied) {
      throw new Error(
        `harness source ${source} does not contain Codex harness files (expected AGENTS.md and/or .codex/)`,
      );
    }
    return;
  }

  const name = basename(source);
  if (name === "AGENTS.md") {
    copyFile(source, join(workspaceDir, "AGENTS.md"));
    return;
  }
  if (name === "config.toml" && basename(dirname(source)) === ".codex") {
    copyFile(source, join(workspaceDir, ".codex", "config.toml"));
    return;
  }
  throw new Error(
    `unsupported Codex harness source: ${source} (use a project dir, AGENTS.md, or .codex/config.toml)`,
  );
}

function copyFile(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { force: true });
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

function readLastMessage(outputFile: string, eventStream: string): string {
  if (existsSync(outputFile)) {
    return readFileSync(outputFile, "utf8");
  }
  return extractLastAgentMessage(eventStream);
}

function extractLastAgentMessage(eventStream: string): string {
  let last = "";
  for (const line of eventStream.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
        last = parsed.item.text ?? "";
      }
    } catch {
      // Ignore non-JSON noise from the CLI; only the agent message matters here.
    }
  }
  return last;
}

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { AgentFn, JudgeFn } from "./anthropic.js";

export interface ClaudeCodeOptions {
  model?: string;
  binary?: string;
  extraArgs?: string[];
  cwd?: string;
}

function runClaude(
  systemPrompt: string,
  userInput: string,
  opts: ClaudeCodeOptions,
): Promise<string> {
  const bin = opts.binary ?? "claude";
  // `--bare` would give maximum isolation but also disables the keychain /
  // OAuth path — with --bare Claude Code requires ANTHROPIC_API_KEY, which
  // defeats the reason to route through Claude Code at all. So we keep
  // OAuth-capable flags and isolate via cwd + --tools "" + --system-prompt
  // override + --no-session-persistence instead.
  const args = [
    "-p",
    "--no-session-persistence",
    "--output-format",
    "text",
    "--tools",
    "",
    "--system-prompt",
    systemPrompt,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  // Running from tmpdir() prevents the project's CLAUDE.md from being
  // auto-discovered and leaked into the adherence test.
  const cwd = opts.cwd ?? tmpdir();

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || `exit ${code}`;
        reject(new Error(`claude -p failed: ${msg}`));
        return;
      }
      resolve(stdout.trimEnd());
    });
    child.stdin.end(userInput);
  });
}

export function makeClaudeCodeAgent(opts: ClaudeCodeOptions = {}): AgentFn {
  return (systemPrompt, userInput) => runClaude(systemPrompt, userInput, opts);
}

export function makeClaudeCodeJudge(opts: ClaudeCodeOptions = {}): JudgeFn {
  const system =
    "You are a strict binary judge. Answer only with the single token 'yes' or 'no', lowercase, no punctuation.";
  return async (judgePrompt, output) => {
    const user = [
      "The following text is the output of another agent:",
      "---BEGIN OUTPUT---",
      output,
      "---END OUTPUT---",
      "",
      `Question: ${judgePrompt}`,
      "",
      "Answer with exactly 'yes' or 'no'.",
    ].join("\n");
    const result = await runClaude(system, user, opts);
    return result.trim().toLowerCase().startsWith("yes");
  };
}

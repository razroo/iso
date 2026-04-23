#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuite } from "./parser.js";
import { formatReport, toJSON } from "./report.js";
import { run } from "./runner.js";
import { claudeCodeRunner } from "./runners/claude-code.js";
import { codexRunner } from "./runners/codex.js";
import { cursorRunner } from "./runners/cursor.js";
import { fakeRunner } from "./runners/fake.js";
import { opencodeRunner } from "./runners/opencode.js";
import type { RunnerFn, RunnerName } from "./types.js";

const USAGE = `iso-eval — behavioral eval runner for AI coding agents

usage:
  iso-eval --version | -v
  iso-eval --help | -h
  iso-eval run  <suite> [--filter <task-id>] [--concurrency N] [--runner <name>]
                        [--harness-source <path>]
                        [--json] [--keep-workspaces]
  iso-eval plan <suite>

runners: fake, codex, claude-code, cursor, opencode
`;

function getRunner(name: RunnerName): RunnerFn {
  switch (name) {
    case "fake":
      return fakeRunner;
    case "codex":
      return codexRunner;
    case "claude-code":
      return claudeCodeRunner;
    case "cursor":
      return cursorRunner;
    case "opencode":
      return opencodeRunner;
    default: {
      const exhaustive: never = name;
      throw new Error(`runner "${String(exhaustive)}" is not implemented in iso-eval`);
    }
  }
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

async function cmdRun(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("iso-eval run: missing <suite> path");
    return 2;
  }
  const suitePath = args[0];
  let filter: string | undefined;
  let concurrency = 1;
  let runnerOverride: RunnerName | undefined;
  let harnessSourceOverride: string | undefined;
  let json = false;
  let keepWorkspaces = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--filter") {
      filter = args[++i];
    } else if (a === "--concurrency") {
      concurrency = parseInt(args[++i] ?? "1", 10);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        console.error(`iso-eval run: --concurrency must be a positive integer`);
        return 2;
      }
    } else if (a === "--runner") {
      const raw = args[++i] as RunnerName | undefined;
      if (!raw || !["fake", "codex", "claude-code", "cursor", "opencode"].includes(raw)) {
        console.error(`iso-eval run: --runner must be one of: fake, codex, claude-code, cursor, opencode`);
        return 2;
      }
      runnerOverride = raw;
    } else if (a === "--harness-source") {
      harnessSourceOverride = args[++i];
      if (!harnessSourceOverride) {
        console.error(`iso-eval run: --harness-source requires a path`);
        return 2;
      }
    } else if (a === "--json") {
      json = true;
    } else if (a === "--keep-workspaces") {
      keepWorkspaces = true;
    } else {
      console.error(`iso-eval run: unknown flag "${a}"`);
      return 2;
    }
  }
  const suite = loadSuite(suitePath);
  const effectiveSuite =
    runnerOverride || harnessSourceOverride
      ? {
          ...suite,
          runner: runnerOverride ?? suite.runner,
          harnessSource: harnessSourceOverride ?? suite.harnessSource,
        }
      : suite;
  const runner = getRunner(effectiveSuite.runner);
  const report = await run(effectiveSuite, {
    runner,
    concurrency,
    keepWorkspaces,
    filter: filter ? (id) => id === filter : undefined,
  });
  console.log(json ? toJSON(report) : formatReport(report));
  return report.passed ? 0 : 1;
}

function cmdPlan(args: string[]): number {
  if (args.length === 0) {
    console.error("iso-eval plan: missing <suite> path");
    return 2;
  }
  const suite = loadSuite(args[0]);
  console.log(`suite:    ${suite.name}`);
  console.log(`runner:   ${suite.runner}`);
  console.log(`timeout:  ${suite.timeoutMs ?? "none"}`);
  console.log(`tasks:    ${suite.tasks.length}`);
  for (const t of suite.tasks) {
    console.log(`  - ${t.id} (trials: ${t.trials}, checks: ${t.checks.length})`);
    console.log(`      workspace: ${t.workspace}`);
    if (t.checks.length) {
      console.log(`      checks:    ${t.checks.map((c) => c.type).join(", ")}`);
    }
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    return args.length === 0 ? 0 : 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(readVersion());
    return 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);
  if (cmd === "run") return cmdRun(rest);
  if (cmd === "plan") return cmdPlan(rest);
  console.error(`iso-eval: unknown command "${cmd}"\n`);
  console.error(USAGE);
  return 2;
}

main(process.argv).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`iso-eval: ${msg}`);
    process.exit(1);
  },
);

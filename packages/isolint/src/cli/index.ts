#!/usr/bin/env node
import { mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { Planner } from "../planner/index.js";
import { createProvider, type ProviderSpec } from "../providers/factory.js";
import { Runtime } from "../runtime/index.js";
import { assertPlan } from "../schema/validate.js";
import { formatPlanPerformance, lintPlanPerformance } from "../schema/performance.js";
import { createLogger, type LogLevel } from "../util/logger.js";
import { discoverFiles, discoverRepoFiles } from "../lint/scanner.js";
import { loadConfig } from "../lint/config.js";
import { changedFilesSince, findGitRoot } from "../lint/git-diff.js";
import { PRESETS, rulesFromPresets } from "../lint/preset.js";
import { runLint, exitCodeFor } from "../lint/runner.js";
import { computeFixes, writeFiles } from "../lint/fix.js";
import { computeCost, formatCost } from "./cost.js";
import { verify, formatVerifyReport } from "./verify.js";
import {
  formatText,
  formatJSON,
  formatSARIF,
  formatFixSummary,
  formatRuleStats,
  unifiedDiff,
} from "../lint/report.js";
import type { Severity } from "../lint/types.js";
import { flagBool, flagString, parseArgs } from "./args.js";
import { loadDotEnv } from "./env.js";

const HELP = `isolint - lint AI harness markdown for weak small models

Usage:
  isolint lint    <path> [--fix] [--llm] [--format text|json|sarif] [--diff] [--fail-on error|warn|info]
  isolint cost    [path] [--format text|json] [--no-sections]
  isolint verify  --harness <file.md> --input <file.json|md> [--small <model>] [--large <model>]
  isolint plan    --task <text> [--hints <text>] --out <file.json> [provider flags]
  isolint run     --plan <file.json> --input <file.json|->  [--out <file.json>] [provider flags]
  isolint validate --plan <file.json> [--perf]

Cost flags:
  --format <fmt>        text (default) | json
  --no-sections         Do not break shared-prefix files into sections
  --budget <n>          Exit non-zero if shared-prefix total tokens exceed n
  --ext <list>          Comma-separated extensions (default: .md,.mdc,.mdx)
  --ignore <glob>       Extra ignore glob (repeatable)
  --no-gitignore        Do not honor .gitignore

Verify flags:
  --harness <path>      Harness file to verify (required)
  --input <path>        Input for the harness — file or "-" for stdin (required)
  --small <model>       Target small model (the one whose fragility matters)
  --large <model>       Model used to apply --fix rewrites before the after-run

Validate flags:
  --perf                Also run advisory plan-performance checks

Lint flags:
  --preset <name>       Preset(s) to run: recommended | strict | performance.
                        Repeatable (--preset recommended --preset performance) or
                        comma-separated (--preset recommended,performance).
                        Overrides the config's "extends" when set.
  --fix                 Apply deterministic fixes; with --llm also apply LLM rewrites
  --llm                 Enable LLM-tier rules (and LLM rewrites with --fix)
  --format <fmt>        text (default) | json | sarif
  --diff                Print a unified diff instead of writing files
  --config <path>       Path to .isolint.json (default: <root>/.isolint.json)
  --ext <list>          Comma-separated extensions (default: .md,.mdc,.mdx)
  --fail-on <sev>       error (default) | warn | info
  --ignore <glob>       Extra ignore glob (repeatable)
  --no-gitignore        Do not honor .gitignore (default: honored when inside a git repo)
  --since <ref>         Only lint files changed since <ref> (e.g. main, origin/main)
  --stats               With --fix: print per-rule rewrite accept/reject counts
  --dry-run             With --fix: compute fixes but do not write to disk

Provider flags (plan / run / lint --llm):
  --large <model>       Model slug for the planner / lint rewrites (env: ISOLINT_LARGE)
  --small <model>       Model slug for the runtime   (env: ISOLINT_SMALL)
  --provider <name>     openrouter | openai | ollama | custom
  --base-url <url>      Override base URL for provider
  --api-key <key>       Override API key

Other flags:
  --verbose, -v         Debug logging
  --quiet               Silent logging
  --help, -h            Show this help
`;

async function main(): Promise<void> {
  loadDotEnv();

  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || flagBool(flags, "help", "h")) {
    process.stdout.write(HELP);
    return;
  }

  const level: LogLevel = flagBool(flags, "verbose", "v")
    ? "debug"
    : flagBool(flags, "quiet")
      ? "silent"
      : "info";
  const log = createLogger(level);

  switch (command) {
    case "plan":
      await cmdPlan(flags, log);
      return;
    case "run":
      await cmdRun(flags, log);
      return;
    case "validate":
      cmdValidate(flags);
      return;
    case "lint":
      await cmdLint(parseArgs(process.argv.slice(2)).positional, flags);
      return;
    case "cost":
      cmdCost(parseArgs(process.argv.slice(2)).positional, flags);
      return;
    case "verify":
      await cmdVerify(flags, log);
      return;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      process.exit(2);
  }
}

async function cmdPlan(flags: Record<string, string | boolean>, log: ReturnType<typeof createLogger>): Promise<void> {
  const task = flagString(flags, "task");
  const outPath = flagString(flags, "out", "o");
  if (!task) throw new Error("--task is required");
  if (!outPath) throw new Error("--out is required");

  const spec = resolveLargeSpec(flags);
  log.info("planner", { model: spec.model, provider: spec.provider ?? "auto" });

  const planner = new Planner(createProvider(spec));
  const { plan, attempts } = await planner.generate({
    task,
    hints: flagString(flags, "hints"),
  });

  const abs = resolve(process.cwd(), outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(plan, null, 2) + "\n", "utf8");
  log.info("plan written", { path: abs, attempts, steps: plan.steps.length });

  const perfFindings = lintPlanPerformance(plan);
  process.stdout.write("\n" + formatPlanPerformance(perfFindings) + "\n");
}

async function cmdRun(flags: Record<string, string | boolean>, log: ReturnType<typeof createLogger>): Promise<void> {
  const planPath = flagString(flags, "plan");
  const inputPath = flagString(flags, "input", "i");
  const outPath = flagString(flags, "out", "o");
  if (!planPath) throw new Error("--plan is required");
  if (!inputPath) throw new Error("--input is required");

  const plan = JSON.parse(readFileSync(resolve(process.cwd(), planPath), "utf8"));
  assertPlan(plan);

  const inputRaw = inputPath === "-"
    ? readStdin()
    : readFileSync(resolve(process.cwd(), inputPath), "utf8");
  const input = JSON.parse(inputRaw);

  const spec = resolveSmallSpec(flags);
  log.info("runtime", { model: spec.model, provider: spec.provider ?? "auto" });

  const runtime = new Runtime(createProvider(spec), { logger: log });
  const result = await runtime.run(plan, input);

  const payload = JSON.stringify(result, null, 2);
  if (outPath) {
    const abs = resolve(process.cwd(), outPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, payload + "\n", "utf8");
    log.info("result written", { path: abs, ok: result.ok });
  } else {
    process.stdout.write(payload + "\n");
  }
  if (!result.ok) process.exit(1);
}

function cmdValidate(flags: Record<string, string | boolean>): void {
  const planPath = flagString(flags, "plan");
  if (!planPath) throw new Error("--plan is required");
  const plan = JSON.parse(readFileSync(resolve(process.cwd(), planPath), "utf8"));
  assertPlan(plan);
  process.stdout.write(`plan "${plan.name}" is valid (${plan.steps.length} steps)\n`);

  if (flagBool(flags, "perf", "performance")) {
    const findings = lintPlanPerformance(plan);
    process.stdout.write("\n" + formatPlanPerformance(findings) + "\n");
  }
}

async function cmdLint(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const target = positional[0] ?? ".";
  const cwd = resolve(process.cwd(), target);
  // Repo root for cross-reference rules. Falls back to process.cwd() when
  // not inside a git checkout — keeps non-git directories linting cleanly.
  const repoRoot = findGitRoot(cwd) ?? process.cwd();

  // Load config relative to the target, not process.cwd(). Explicit
  // --config paths are still resolved from process.cwd() for ergonomics.
  const config = loadConfig(
    cwd,
    flagString(flags, "config"),
  );

  const extFlag = flagString(flags, "ext") ?? ".md,.mdc,.mdx";
  const include_ext = extFlag.split(",").map((e) => (e.startsWith(".") ? e : "." + e)).map((e) => e.toLowerCase());

  const extraIgnore = flagArray(flags, "ignore");
  const ignore = [...config.ignore, ...extraIgnore];
  const use_gitignore = !flagBool(flags, "no-gitignore");

  let discovered = discoverFiles(cwd, { include_ext, ignore, use_gitignore });
  // Re-base rel_path against the repo root so path-gated rules
  // (`ctx.file.match(/modes\/|prompts\/|skills\/|agents\//)`) and
  // link-resolution rules (stale-link-reference, missing-file-reference)
  // see the file's full repo-relative path even when the user lints a
  // subdirectory like `isolint lint modes/`.
  discovered = discovered.map((f) => ({ ...f, rel_path: relative(repoRoot, f.abs_path) }));

  const since = flagString(flags, "since");
  if (since) {
    const gitRoot = findGitRoot(cwd);
    if (!gitRoot) {
      process.stderr.write(`[isolint] --since requires a git repository; ${cwd} is not one.\n`);
      process.exit(2);
    }
    const changed = changedFilesSince(gitRoot, since);
    discovered = discovered.filter((f) => changed.has(f.abs_path));
    if (discovered.length === 0) {
      process.stdout.write(`no files matching extensions changed since ${since}\n`);
      return;
    }
  }

  const useLLM = flagBool(flags, "llm");
  let model;
  if (useLLM) {
    const spec = resolveLargeSpec(flags);
    model = createProvider(spec);
  }

  const presetNames = flagArray(flags, "preset");
  const unknownPresets = presetNames.filter((name) => !(name in PRESETS));
  if (unknownPresets.length > 0) {
    process.stderr.write(
      `[isolint] unknown preset(s): ${unknownPresets.join(", ")}\n` +
        `         valid presets: ${Object.keys(PRESETS).join(", ")}\n`,
    );
    process.exit(2);
  }
  const presetRules =
    presetNames.length > 0 ? rulesFromPresets(presetNames) : undefined;

  // Scan from the repo root (not the lint target) so cross-reference rules
  // can resolve links pointing outside the target — e.g. a `modes/README.md`
  // that links to `[..](../CONTRIBUTING.md)` at the project root.
  const repoFiles = discoverRepoFiles(repoRoot, { ignore, use_gitignore });

  const lintReport = await runLint(
    discovered.map((f) => ({ rel_path: f.rel_path, source: f.source })),
    config,
    { llm: useLLM, model, repo_files: repoFiles, rules: presetRules },
  );

  const format = (flagString(flags, "format") ?? "text") as "text" | "json" | "sarif";

  const doFix = flagBool(flags, "fix");
  const doDiff = flagBool(flags, "diff");
  const dryRun = flagBool(flags, "dry-run");

  if (doFix) {
    const fixReport = await computeFixes(
      discovered.map((f) => ({ rel_path: f.rel_path, abs_path: f.abs_path, source: f.source })),
      lintReport.findings,
      { use_llm: useLLM, model, dry_run: dryRun, config },
    );

    if (doDiff || dryRun) {
      for (const f of fixReport.files) {
        if (!f.changed) continue;
        const diff = unifiedDiff(f.rel_path, f.original, f.fixed);
        if (diff) process.stdout.write(diff);
      }
      process.stderr.write(formatFixSummary(fixReport) + "\n");
    } else {
      const written = writeFiles(fixReport, cwd);
      process.stderr.write(formatFixSummary(fixReport) + `\n${written} file${written === 1 ? "" : "s"} written\n`);
    }
    if (flagBool(flags, "stats")) {
      process.stderr.write("\n" + formatRuleStats(fixReport) + "\n");
    }
    return;
  }

  const out =
    format === "json"
      ? formatJSON(lintReport)
      : format === "sarif"
        ? formatSARIF(lintReport)
        : formatText(lintReport);
  process.stdout.write(out + "\n");

  const threshold = (flagString(flags, "fail-on") ?? "error") as Severity;
  const code = exitCodeFor(lintReport, threshold);
  if (code !== 0) process.exit(code);
}

function cmdCost(
  positional: string[],
  flags: Record<string, string | boolean>,
): void {
  const target = positional[0] ?? ".";
  const cwd = resolve(process.cwd(), target);

  const config = loadConfig(cwd, flagString(flags, "config"));
  const extFlag = flagString(flags, "ext") ?? ".md,.mdc,.mdx";
  const include_ext = extFlag
    .split(",")
    .map((e) => (e.startsWith(".") ? e : "." + e))
    .map((e) => e.toLowerCase());

  const extraIgnore = flagArray(flags, "ignore");
  const ignore = [...config.ignore, ...extraIgnore];
  const use_gitignore = !flagBool(flags, "no-gitignore");
  const sections = !flagBool(flags, "no-sections");

  const discovered = discoverFiles(cwd, { include_ext, ignore, use_gitignore });
  const report = computeCost(discovered, { sections });

  const format = (flagString(flags, "format") ?? "text") as "text" | "json";
  if (format === "json") {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatCost(report, { sections }) + "\n");
  }

  const budgetFlag = flagString(flags, "budget");
  if (budgetFlag !== undefined) {
    const budget = Number.parseInt(budgetFlag, 10);
    if (!Number.isFinite(budget) || budget <= 0) {
      process.stderr.write(`[isolint] --budget must be a positive integer (got "${budgetFlag}")\n`);
      process.exit(2);
    }
    if (report.shared_prefix_total_tokens > budget) {
      process.stderr.write(
        `\n[isolint] shared-prefix cost ${report.shared_prefix_total_tokens} exceeds budget ${budget} (over by ${report.shared_prefix_total_tokens - budget})\n`,
      );
      process.exit(1);
    }
  }
}

async function cmdVerify(
  flags: Record<string, string | boolean>,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const harness = flagString(flags, "harness");
  const input = flagString(flags, "input", "i");
  if (!harness) throw new Error("--harness is required");
  if (!input) throw new Error("--input is required");

  const smallSpec = resolveSmallSpec(flags);
  const largeSpec = resolveLargeSpec(flags);
  log.info("verify", { small: smallSpec.model, large: largeSpec.model });

  const report = await verify({
    harness_path: harness,
    input_path: input,
    model: createProvider(smallSpec),
    fixModel: createProvider(largeSpec),
    cwd: process.cwd(),
  });

  process.stdout.write(formatVerifyReport(report) + "\n");
}

function flagArray(flags: Record<string, string | boolean>, key: string): string[] {
  const v = flags[key];
  if (typeof v !== "string") return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function resolveLargeSpec(flags: Record<string, string | boolean>): ProviderSpec {
  const model =
    flagString(flags, "large") ??
    process.env.ISOLINT_LARGE ??
    process.env.ISOMODEL_LARGE;
  if (!model) throw new Error("Set --large or ISOLINT_LARGE");
  return {
    model,
    provider: flagString(flags, "provider"),
    baseUrl: flagString(flags, "base-url"),
    apiKey: flagString(flags, "api-key"),
  };
}

function resolveSmallSpec(flags: Record<string, string | boolean>): ProviderSpec {
  const model =
    flagString(flags, "small") ??
    process.env.ISOLINT_SMALL ??
    process.env.ISOMODEL_SMALL;
  if (!model) throw new Error("Set --small or ISOLINT_SMALL");
  return {
    model,
    provider: flagString(flags, "provider"),
    baseUrl: flagString(flags, "base-url"),
    apiKey: flagString(flags, "api-key"),
  };
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(65536);
  while (true) {
    let bytes = 0;
    try {
      bytes = readSync(0, buf, 0, buf.length, null);
    } catch {
      break;
    }
    if (bytes <= 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((err) => {
  process.stderr.write(`[isolint] error: ${(err as Error).message}\n`);
  process.exit(1);
});

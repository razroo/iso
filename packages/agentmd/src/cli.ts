#!/usr/bin/env node
import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { loadDotEnv } from "./env.js";
import { parse } from "./parser.js";
import { lint, formatDiagnostic } from "./linter.js";
import { render } from "./render.js";
import { loadFixtures } from "./fixtures.js";
import { run } from "./runner.js";
import {
  formatBaselineDiff,
  formatReport,
  overallPassed,
  overallPercentage,
  toJSON,
} from "./report.js";
import { DEFAULT_TEMPERATURE, makeAgent, makeJudge } from "./anthropic.js";
import { makeClaudeCodeAgent, makeClaudeCodeJudge } from "./claude-code.js";
import { diffPrompts, formatDiff } from "./diff.js";
import { formatHistory, loadHistory } from "./history.js";
import type { AgentFn, JudgeFn } from "./anthropic.js";
import type { Backend, Diagnostic, RunMeta } from "./types.js";
import type { ProgressFn, RunResult } from "./runner.js";

const USAGE = `agentmd — structured markdown linter and adherence tester for agent prompts

usage:
  agentmd --version | -v
  agentmd lint <file|glob ...> [--format <text|json|github|sarif>] [--watch]
  agentmd lint - [--format <text|json|github|sarif>] # read stdin
  agentmd render <file|-> [--out <path>]
  agentmd test <file> --fixtures <path>
                      [--via <api|claude-code>] [--model <id>]
                      [--temperature <n>] [--concurrency <n>] [--trials <n>]
                      [--timeout <ms>]
                      [--rule <ID>] [--fail-under <pct>]
                      [--format <text|json>] [--out <path>]
                      [--baseline <path>] [--list]
                      [--verbose] [--watch]
  agentmd diff <old.md> <new.md>
  agentmd history <glob> [--rule <ID>]
  agentmd new <name> [--dir <path>]

commands:
  lint      validate structural conventions in the prompt file
  render    emit the compiled prompt (the form the model sees)
  test      run fixture cases against the compiled prompt and report per-rule adherence
  diff      structural diff of rule sets between two prompt files
  history   per-rule adherence trend across multiple JSON reports
  new       scaffold a starter agent file and fixture

test backends (--via):
  api           call the Anthropic SDK directly (requires ANTHROPIC_API_KEY) [default]
  claude-code   shell out to 'claude -p' (uses your Claude Code login; no API key needed)

notes:
  --temperature defaults to 0 for the api backend; ignored by claude-code (no such flag)
  --trials N reports pass rate per case (useful when the backend is non-deterministic;
  the api backend is deterministic at temp=0 so trials > 1 there just costs tokens)
  --rule <ID> filters fixtures to expectations for that rule; skips cases with none left
  --fail-under <pct> exits non-zero if overall adherence < pct (independent of --baseline)
  --list parses and prints the test plan without calling the model
  --baseline expects a JSON report produced by an earlier --format json run; exits
  non-zero if any rule's adherence is lower than in the baseline

env:
  ANTHROPIC_API_KEY  required for \`agentmd test --via api\` (also read from .env)
`;

const SCAFFOLD_AGENT = (name: string) => `# Agent: ${name}

One short paragraph describing what this agent does.

## Hard limits

- [H1] Replace with a concrete, non-negotiable rule.
  why: the motivation — ideally a past incident or measured failure mode

## Defaults

- [D1] Replace with a sensible default the agent may override with a stated reason.
  why: why this is the right default most of the time

## Procedure

1. One action per step.
2. Reference rules inline like [H1], [D1].
3. Self-check against [H1], [D1]; revise if any fail.

## Routing

| When | Do |
|------|-----|
| specific condition | specific action |
| otherwise | fallback action |

## Output format

Describe the exact shape the agent must return.
`;

const SCAFFOLD_FIXTURES = (name: string) => `agent: ${name}
cases:
  - name: smoke
    input: "Replace me with a representative user input."
    expectations:
      - rule: H1
        check: word_count_le
        value: 200
      - rule: D1
        check: llm_judge
        prompt: "Does the output follow [D1]? Answer yes only if it does."
`;

type Argv = {
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Argv {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const key = body;
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function loadDoc(path: string) {
  const source = readFileSync(path, "utf8");
  return parse(source, path);
}

function readStdinSync(): string {
  // Node 22's readFileSync supports fd 0 on POSIX; on some shells it returns "".
  try {
    return readFileSync(0, "utf8");
  } catch (err) {
    throw new Error(
      `failed to read stdin: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function expandLintTargets(patterns: string[]): string[] {
  const out = new Set<string>();
  for (const p of patterns) {
    if (p === "-") {
      out.add("-");
      continue;
    }
    // A literal path that exists short-circuits any glob interpretation, so
    // files named like "a[b].md" don't silently resolve to nothing.
    if (existsSync(p)) {
      out.add(p);
      continue;
    }
    const matches = globSync(p);
    if (matches.length === 0) {
      // Preserve the user-provided pattern so the caller gets a clear
      // "file not found" instead of silently skipping a typo.
      out.add(p);
      continue;
    }
    for (const m of matches) out.add(m);
  }
  return [...out];
}

interface LintOutcome {
  displayPath: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  parseError?: string;
}

function lintOne(target: string): LintOutcome {
  let source: string;
  let displayPath: string;
  if (target === "-") {
    displayPath = "<stdin>";
    try {
      source = readStdinSync();
    } catch (err) {
      return {
        displayPath,
        diagnostics: [],
        errorCount: 1,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    displayPath = target;
    try {
      source = readFileSync(resolve(target), "utf8");
    } catch (err) {
      return {
        displayPath,
        diagnostics: [],
        errorCount: 1,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const doc = parse(source, displayPath);
  const diagnostics = lint(doc);
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  return { displayPath, diagnostics, errorCount };
}

type LintFormat = "text" | "json" | "github" | "sarif";

function sarifLevel(sev: Diagnostic["severity"]): "error" | "warning" | "note" {
  if (sev === "error") return "error";
  if (sev === "warning") return "warning";
  return "note";
}

function renderSARIF(outcomes: LintOutcome[]): string {
  const ruleIds = new Set<string>();
  const results: unknown[] = [];
  for (const o of outcomes) {
    if (o.parseError) {
      ruleIds.add("parse-error");
      results.push({
        ruleId: "parse-error",
        level: "error",
        message: { text: o.parseError },
        locations: [
          { physicalLocation: { artifactLocation: { uri: o.displayPath } } },
        ],
      });
      continue;
    }
    for (const d of o.diagnostics) {
      ruleIds.add(d.code);
      const region = d.line ? { region: { startLine: d.line } } : {};
      results.push({
        ruleId: d.code,
        level: sarifLevel(d.severity),
        message: { text: d.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: o.displayPath },
              ...region,
            },
          },
        ],
      });
    }
  }
  const rules = [...ruleIds].map((id) => ({
    id,
    name: id,
    shortDescription: { text: id },
  }));
  return (
    JSON.stringify(
      {
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: [
          {
            tool: {
              driver: {
                name: "agentmd",
                informationUri: "https://github.com/razroo/iso/tree/main/packages/agentmd",
                rules,
              },
            },
            results,
          },
        ],
      },
      null,
      2,
    ) + "\n"
  );
}

function renderLint(outcomes: LintOutcome[], format: LintFormat): string {
  if (format === "sarif") return renderSARIF(outcomes);
  if (format === "json") {
    const payload = outcomes.map((o) => ({
      file: o.displayPath,
      parseError: o.parseError ?? null,
      diagnostics: o.diagnostics,
    }));
    return JSON.stringify(payload, null, 2) + "\n";
  }
  if (format === "github") {
    const lines: string[] = [];
    for (const o of outcomes) {
      if (o.parseError) {
        lines.push(`::error file=${o.displayPath}::${o.parseError}`);
        continue;
      }
      for (const d of o.diagnostics) {
        const sev = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "notice";
        const linePart = d.line ? `,line=${d.line}` : "";
        lines.push(
          `::${sev} file=${o.displayPath}${linePart},title=${d.code}::${d.message.replace(/\n/g, " ")}`,
        );
      }
    }
    return lines.join("\n") + (lines.length ? "\n" : "");
  }
  // text
  const parts: string[] = [];
  let totalDiags = 0;
  let totalErrors = 0;
  for (const o of outcomes) {
    if (o.parseError) {
      parts.push(`${o.displayPath}: error — ${o.parseError}`);
      totalErrors++;
      continue;
    }
    if (!o.diagnostics.length) {
      parts.push(`${o.displayPath}: ok (0 diagnostics)`);
      continue;
    }
    for (const d of o.diagnostics) {
      parts.push(formatDiagnostic(d, o.displayPath));
    }
    totalDiags += o.diagnostics.length;
    totalErrors += o.errorCount;
  }
  if (outcomes.length > 1 || totalDiags > 0) {
    parts.push(
      `\n${totalDiags} diagnostic${totalDiags === 1 ? "" : "s"} across ${outcomes.length} file${outcomes.length === 1 ? "" : "s"} (${totalErrors} error${totalErrors === 1 ? "" : "s"})`,
    );
  }
  return parts.join("\n") + "\n";
}

function runLintOnce(targets: string[], format: LintFormat = "text"): number {
  const outcomes = targets.map((t) => lintOne(t));
  process.stdout.write(renderLint(outcomes, format));
  const hasErrors = outcomes.some((o) => o.errorCount > 0 || o.parseError);
  return hasErrors ? 1 : 0;
}

interface TestOnceOptions {
  agent: AgentFn;
  judge: JudgeFn | undefined;
  meta: Partial<RunMeta>;
  concurrency: number;
  trials: number;
  ruleFilter: string | null;
  failUnder: number | null;
  verbose: boolean;
  format: "text" | "json";
  outPath: string | null;
  baselinePath: string | null;
  list: boolean;
  progress: boolean;
  timeoutMs: number | null;
}

function loadBaseline(path: string): RunResult | null {
  try {
    const raw = readFileSync(resolve(path), "utf8");
    return JSON.parse(raw) as RunResult;
  } catch (err) {
    process.stderr.write(
      `failed to read baseline at ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

async function runTestOnce(
  file: string,
  fixturesPath: string,
  opts: TestOnceOptions,
): Promise<number> {
  let doc;
  try {
    doc = loadDoc(resolve(file));
  } catch (err) {
    process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  const diags = lint(doc);
  const errors = diags.filter((d) => d.severity === "error");
  if (errors.length) {
    process.stderr.write(
      `refusing to run tests: file has ${errors.length} lint error(s). Run \`agentmd lint ${file}\` first.\n`,
    );
    return 2;
  }
  let fixtures;
  try {
    fixtures = loadFixtures(resolve(fixturesPath));
  } catch (err) {
    process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (opts.list) {
    let totalCases = fixtures.cases.length;
    let totalExpectations = 0;
    const casesToRun: string[] = [];
    for (const c of fixtures.cases) {
      const exps = opts.ruleFilter
        ? c.expectations.filter((e) => e.rule === opts.ruleFilter)
        : c.expectations;
      if (opts.ruleFilter && !exps.length) continue;
      totalExpectations += exps.length;
      casesToRun.push(`  - ${c.name} (${exps.length} expectation${exps.length === 1 ? "" : "s"})`);
    }
    const header = opts.ruleFilter
      ? `plan (rule filter [${opts.ruleFilter}]): ${casesToRun.length}/${totalCases} cases, ${totalExpectations} expectations, ${opts.trials} trial${opts.trials === 1 ? "" : "s"} each, via ${opts.meta.via ?? "?"}`
      : `plan: ${casesToRun.length} case${casesToRun.length === 1 ? "" : "s"}, ${totalExpectations} expectation${totalExpectations === 1 ? "" : "s"}, ${opts.trials} trial${opts.trials === 1 ? "" : "s"} each, via ${opts.meta.via ?? "?"}`;
    process.stdout.write(header + "\n");
    for (const line of casesToRun) process.stdout.write(line + "\n");
    return 0;
  }

  const progress: ProgressFn | undefined = opts.progress
    ? ({ caseIndex, totalCases, caseName }) => {
        process.stderr.write(`[${caseIndex}/${totalCases}] ${caseName}\n`);
      }
    : undefined;

  let result;
  try {
    result = await run(doc, fixtures, {
      agent: opts.agent,
      judge: opts.judge,
      meta: opts.meta,
      concurrency: opts.concurrency,
      trials: opts.trials,
      ruleFilter: opts.ruleFilter ?? undefined,
      timeoutMs: opts.timeoutMs ?? undefined,
      onCaseComplete: progress,
    });
  } catch (err) {
    process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const rendered =
    opts.format === "json"
      ? toJSON(result)
      : formatReport(result, { verbose: opts.verbose }) + "\n";
  if (opts.outPath) {
    writeFileSync(resolve(opts.outPath), rendered);
    process.stdout.write(`wrote ${opts.outPath}\n`);
  } else {
    process.stdout.write(rendered);
  }

  let regressed = false;
  if (opts.baselinePath) {
    const baseline = loadBaseline(opts.baselinePath);
    if (!baseline) return 2;
    const diff = formatBaselineDiff(result, baseline);
    process.stdout.write("\n" + diff.rendered + "\n");
    if (diff.regressedRules.length) {
      process.stdout.write(
        `\nregression: ${diff.regressedRules.map((r) => `[${r}]`).join(", ")}\n`,
      );
      regressed = true;
    }
  }

  if (opts.failUnder !== null) {
    const actual = overallPercentage(result);
    if (actual < opts.failUnder) {
      process.stdout.write(
        `\nfail-under: overall ${actual}% < required ${opts.failUnder}%\n`,
      );
      return 1;
    }
  }

  if (regressed) return 1;
  return overallPassed(result) ? 0 : 1;
}

function watchFiles(paths: string[], onChange: () => void) {
  let timer: NodeJS.Timeout | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 120);
  };
  const dirs = new Set(paths.map((p) => dirname(resolve(p))));
  const targets = new Set(paths.map((p) => basename(resolve(p))));
  for (const d of dirs) {
    try {
      watch(d, (_event, filename) => {
        if (filename && targets.has(filename.toString())) trigger();
      });
    } catch (err) {
      process.stderr.write(`watch failed for ${d}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  process.stdout.write(`watching ${paths.join(", ")} — press ^C to exit\n`);
}

function scaffoldNew(name: string, dir: string): number {
  const agentPath = resolve(dir, `${name}.md`);
  const fixturesDir = resolve(dir, "fixtures");
  const fixturesPath = resolve(fixturesDir, `${name}.yml`);
  if (existsSync(agentPath)) {
    process.stderr.write(`refusing to overwrite existing file: ${agentPath}\n`);
    return 1;
  }
  if (existsSync(fixturesPath)) {
    process.stderr.write(`refusing to overwrite existing file: ${fixturesPath}\n`);
    return 1;
  }
  if (!existsSync(fixturesDir)) {
    mkdirSync(fixturesDir, { recursive: true });
  }
  writeFileSync(agentPath, SCAFFOLD_AGENT(name));
  writeFileSync(fixturesPath, SCAFFOLD_FIXTURES(name));
  process.stdout.write(
    `created ${agentPath}\ncreated ${fixturesPath}\n\nnext:\n  agentmd lint ${agentPath}\n  agentmd test ${agentPath} --fixtures ${fixturesPath} --via claude-code\n`,
  );
  return 0;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`agentmd ${readVersion()}\n`);
    return;
  }
  loadDotEnv();
  const { positional, flags } = parseArgs(rest);

  if (cmd === "lint") {
    if (!positional.length) {
      process.stderr.write(
        `usage: agentmd lint <file|glob ...> [--format text|json|github] [--watch]\n`,
      );
      process.exit(2);
    }
    const formatFlag = typeof flags.format === "string" ? flags.format : "text";
    if (
      formatFlag !== "text" &&
      formatFlag !== "json" &&
      formatFlag !== "github" &&
      formatFlag !== "sarif"
    ) {
      process.stderr.write(
        `unknown --format value: ${formatFlag} (expected 'text', 'json', 'github', or 'sarif')\n`,
      );
      process.exit(2);
    }
    const targets = expandLintTargets(positional);
    const format = formatFlag as LintFormat;
    if (flags.watch === true) {
      if (targets.includes("-")) {
        process.stderr.write(`--watch cannot be combined with stdin input\n`);
        process.exit(2);
      }
      runLintOnce(targets, format);
      watchFiles(targets, () => {
        process.stdout.write(`\n--- change detected, re-linting ---\n`);
        runLintOnce(targets, format);
      });
      return;
    }
    process.exit(runLintOnce(targets, format));
  }

  if (cmd === "render") {
    const file = positional[0];
    if (!file) {
      process.stderr.write(`usage: agentmd render <file|-> [--out <path>]\n`);
      process.exit(2);
    }
    let doc;
    if (file === "-") {
      doc = parse(readStdinSync(), "<stdin>");
    } else {
      doc = loadDoc(resolve(file));
    }
    const out = render(doc);
    const outPath = typeof flags.out === "string" ? flags.out : null;
    if (outPath) {
      writeFileSync(resolve(outPath), out);
      process.stdout.write(`wrote ${outPath}\n`);
    } else {
      process.stdout.write(out);
    }
    return;
  }

  if (cmd === "test") {
    const file = positional[0];
    const fixturesPath = typeof flags.fixtures === "string" ? flags.fixtures : null;
    if (!file || !fixturesPath) {
      process.stderr.write(`usage: agentmd test <file> --fixtures <path> [--model <id>]\n`);
      process.exit(2);
    }
    const model = typeof flags.model === "string" ? flags.model : undefined;
    const viaFlag = typeof flags.via === "string" ? flags.via : "api";
    if (viaFlag !== "api" && viaFlag !== "claude-code") {
      process.stderr.write(`unknown --via value: ${viaFlag} (expected 'api' or 'claude-code')\n`);
      process.exit(2);
    }
    const via = viaFlag as Backend;

    const temperatureFlag = flags.temperature;
    let temperature: number | null = null;
    if (typeof temperatureFlag === "string") {
      const n = Number(temperatureFlag);
      if (Number.isNaN(n)) {
        process.stderr.write(`invalid --temperature value: ${temperatureFlag}\n`);
        process.exit(2);
      }
      temperature = n;
    } else if (via === "api") {
      temperature = DEFAULT_TEMPERATURE;
    }

    let concurrency = 1;
    if (typeof flags.concurrency === "string") {
      const n = Number(flags.concurrency);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write(`invalid --concurrency value: ${flags.concurrency}\n`);
        process.exit(2);
      }
      concurrency = Math.floor(n);
    }

    let trials = 1;
    if (typeof flags.trials === "string") {
      const n = Number(flags.trials);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write(`invalid --trials value: ${flags.trials}\n`);
        process.exit(2);
      }
      trials = Math.floor(n);
    }

    let timeoutMs: number | null = null;
    if (typeof flags.timeout === "string") {
      const n = Number(flags.timeout);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`invalid --timeout value: ${flags.timeout} (expect positive ms)\n`);
        process.exit(2);
      }
      timeoutMs = Math.floor(n);
    }

    const ruleFilter = typeof flags.rule === "string" ? flags.rule : null;

    let failUnder: number | null = null;
    const failUnderFlag = flags["fail-under"];
    if (typeof failUnderFlag === "string") {
      const n = Number(failUnderFlag);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        process.stderr.write(`invalid --fail-under value: ${failUnderFlag} (expect 0-100)\n`);
        process.exit(2);
      }
      failUnder = n;
    }

    const formatFlag = typeof flags.format === "string" ? flags.format : "text";
    if (formatFlag !== "text" && formatFlag !== "json") {
      process.stderr.write(`unknown --format value: ${formatFlag} (expected 'text' or 'json')\n`);
      process.exit(2);
    }
    const format = formatFlag as "text" | "json";

    let agent: AgentFn;
    let judge: JudgeFn;
    if (via === "claude-code") {
      if (typeof flags.temperature === "string") {
        process.stderr.write(
          `warning: --temperature is ignored by the claude-code backend (no such flag on 'claude -p')\n`,
        );
      }
      agent = makeClaudeCodeAgent({ model });
      judge = makeClaudeCodeJudge({ model });
    } else {
      const agentOpts = temperature !== null ? { model, temperature } : { model };
      agent = makeAgent(agentOpts);
      judge = makeJudge(agentOpts);
    }

    const meta: Partial<RunMeta> = {
      via,
      model: model ?? null,
      judgeModel: model ?? null,
      temperature: via === "claude-code" ? null : temperature,
    };

    const verbose = flags.verbose === true || flags.v === true;
    const outPath = typeof flags.out === "string" ? flags.out : null;
    const baselinePath = typeof flags.baseline === "string" ? flags.baseline : null;

    const list = flags.list === true;
    const progress = flags.progress !== false && !list && format !== "json";

    const testOpts: TestOnceOptions = {
      agent,
      judge,
      meta,
      concurrency,
      trials,
      ruleFilter,
      failUnder,
      verbose,
      format,
      outPath,
      baselinePath,
      list,
      progress,
      timeoutMs,
    };

    if (flags.watch === true) {
      await runTestOnce(file, fixturesPath, testOpts);
      watchFiles([file, fixturesPath], () => {
        process.stdout.write(`\n--- change detected, re-running tests ---\n`);
        runTestOnce(file, fixturesPath, testOpts).catch((err) => {
          process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
        });
      });
      return;
    }
    process.exit(await runTestOnce(file, fixturesPath, testOpts));
  }

  if (cmd === "diff") {
    const oldPath = positional[0];
    const newPath = positional[1];
    if (!oldPath || !newPath) {
      process.stderr.write(`usage: agentmd diff <old.md> <new.md>\n`);
      process.exit(2);
    }
    const oldDoc = loadDoc(resolve(oldPath));
    const newDoc = loadDoc(resolve(newPath));
    const d = diffPrompts(oldDoc, newDoc);
    process.stdout.write(formatDiff(oldDoc.agent || oldPath, newDoc.agent || newPath, d));
    return;
  }

  if (cmd === "history") {
    if (!positional.length) {
      process.stderr.write(`usage: agentmd history <report.json> [<report.json> ...] [--rule <ID>]\n`);
      process.exit(2);
    }
    const ruleFilter = typeof flags.rule === "string" ? flags.rule : undefined;
    try {
      const entries = loadHistory(positional.map((p) => resolve(p)));
      process.stdout.write(formatHistory(entries, { ruleFilter }));
    } catch (err) {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "new") {
    const name = positional[0];
    if (!name) {
      process.stderr.write(`usage: agentmd new <name> [--dir <path>]\n`);
      process.exit(2);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      process.stderr.write(`invalid agent name: ${name} (use letters, digits, dot, underscore, hyphen)\n`);
      process.exit(2);
    }
    const dir = typeof flags.dir === "string" ? flags.dir : process.cwd();
    process.exit(scaffoldNew(name, dir));
  }

  process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

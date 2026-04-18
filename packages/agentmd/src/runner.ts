import type { Doc, RunMeta } from "./types.js";
import type { Fixtures, FixtureCase } from "./fixtures.js";
import { formatInput } from "./fixtures.js";
import { render } from "./render.js";
import { runCheck } from "./checks.js";
import type { AgentFn, JudgeFn } from "./anthropic.js";

export interface CaseCheckResult {
  rule: string;
  check: string;
  passed: boolean;
  detail: string;
}

export interface CaseTrial {
  output: string;
  checks: CaseCheckResult[];
}

export interface CaseResult {
  name: string;
  trials: CaseTrial[];
}

export interface RunResult {
  agent: string;
  cases: CaseResult[];
  definedRules: string[];
  meta: RunMeta;
}

export type ProgressFn = (evt: {
  caseIndex: number;
  totalCases: number;
  caseName: string;
  result: CaseResult;
}) => void;

export interface RunOptions {
  agent: AgentFn;
  judge?: JudgeFn;
  meta?: Partial<RunMeta>;
  concurrency?: number;
  trials?: number;
  ruleFilter?: string;
  timeoutMs?: number;
  onCaseComplete?: ProgressFn;
}

function withTimeout<T>(p: Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} exceeded ${ms}ms timeout`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

function fillMeta(partial: Partial<RunMeta> | undefined): RunMeta {
  return {
    via: partial?.via ?? "fake",
    model: partial?.model ?? null,
    judgeModel: partial?.judgeModel ?? null,
    temperature: partial?.temperature ?? null,
    timestamp: partial?.timestamp ?? new Date().toISOString(),
  };
}

export function validateFixturesAgainstDoc(doc: Doc, fixtures: Fixtures): void {
  if (fixtures.agent && fixtures.agent !== doc.agent) {
    throw new Error(
      `Fixtures target agent "${fixtures.agent}" but the prompt defines agent "${doc.agent}". Update the fixture's "agent:" field or point at the right prompt file.`,
    );
  }
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of fixtures.cases) {
    if (seen.has(c.name)) dupes.add(c.name);
    else seen.add(c.name);
  }
  if (dupes.size) {
    const list = [...dupes].map((n) => `  - "${n}"`).join("\n");
    throw new Error(
      `Fixture has duplicate case name(s) — each case must have a unique "name:" so reports aren't ambiguous:\n${list}`,
    );
  }
  const definedIds = new Set<string>();
  for (const r of doc.hardLimits) definedIds.add(r.id);
  for (const r of doc.defaults) definedIds.add(r.id);
  const unknown: { case: string; rule: string }[] = [];
  for (const c of fixtures.cases) {
    for (const exp of c.expectations) {
      if (!definedIds.has(exp.rule)) unknown.push({ case: c.name, rule: exp.rule });
    }
  }
  if (unknown.length) {
    const lines = unknown.map((u) => `  - case "${u.case}" references rule [${u.rule}]`);
    const defined = [...definedIds].sort().join(", ") || "(none)";
    throw new Error(
      `Fixtures reference rule IDs that don't exist in the prompt:\n${lines.join("\n")}\ndefined rules: ${defined}`,
    );
  }
}

export function filterFixturesByRule(fixtures: Fixtures, ruleId: string): Fixtures {
  const cases: FixtureCase[] = [];
  for (const c of fixtures.cases) {
    const filtered = c.expectations.filter((e) => e.rule === ruleId);
    if (filtered.length) cases.push({ ...c, expectations: filtered });
  }
  return { ...fixtures, cases };
}

async function runOneCaseWithTrials(
  systemPrompt: string,
  c: FixtureCase,
  agent: AgentFn,
  judge: JudgeFn | undefined,
  trials: number,
  timeoutMs: number | undefined,
): Promise<CaseResult> {
  const userInput = formatInput(c.input);
  const trialResults: CaseTrial[] = [];
  const wrappedJudge: JudgeFn | undefined = judge
    ? (p, o) => withTimeout(judge(p, o), timeoutMs, `judge for case "${c.name}"`)
    : undefined;
  for (let t = 0; t < trials; t++) {
    const output = await withTimeout(
      agent(systemPrompt, userInput),
      timeoutMs,
      `agent for case "${c.name}" (trial ${t + 1}/${trials})`,
    );
    const checks: CaseCheckResult[] = [];
    for (const exp of c.expectations) {
      const r = await runCheck(exp, output, wrappedJudge);
      checks.push({
        rule: exp.rule,
        check: exp.check,
        passed: r.passed,
        detail: r.detail,
      });
    }
    trialResults.push({ output, checks });
  }
  return { name: c.name, trials: trialResults };
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  const parallel = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: parallel }, run));
  return results;
}

export async function run(
  doc: Doc,
  fixtures: Fixtures,
  opts: RunOptions,
): Promise<RunResult> {
  const effectiveFixtures = opts.ruleFilter
    ? filterFixturesByRule(fixtures, opts.ruleFilter)
    : fixtures;
  validateFixturesAgainstDoc(doc, effectiveFixtures);
  const systemPrompt = render(doc);
  const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 1;
  const trials = opts.trials && opts.trials > 0 ? opts.trials : 1;
  const totalCases = effectiveFixtures.cases.length;
  let completed = 0;
  const cases = await runPool(effectiveFixtures.cases, concurrency, async (c) => {
    const result = await runOneCaseWithTrials(
      systemPrompt,
      c,
      opts.agent,
      opts.judge,
      trials,
      opts.timeoutMs,
    );
    completed += 1;
    opts.onCaseComplete?.({
      caseIndex: completed,
      totalCases,
      caseName: c.name,
      result,
    });
    return result;
  });
  const definedRules = [
    ...doc.hardLimits.map((r) => r.id),
    ...doc.defaults.map((r) => r.id),
  ];
  return {
    agent: doc.agent,
    cases,
    definedRules,
    meta: fillMeta(opts.meta),
  };
}

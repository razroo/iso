import type { RunResult, CaseResult } from "./runner.js";

export interface FormatOptions {
  verbose?: boolean;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export interface RuleAdherence {
  passed: number;
  total: number;
}

export function adherenceByRule(result: RunResult): Map<string, RuleAdherence> {
  const byRule = new Map<string, RuleAdherence>();
  for (const c of result.cases) {
    for (const t of c.trials) {
      for (const ck of t.checks) {
        const entry = byRule.get(ck.rule) ?? { passed: 0, total: 0 };
        entry.total += 1;
        if (ck.passed) entry.passed += 1;
        byRule.set(ck.rule, entry);
      }
    }
  }
  return byRule;
}

interface CheckKey {
  rule: string;
  check: string;
}

function checkKey(ck: CheckKey): string {
  return `${ck.rule}::${ck.check}`;
}

function aggregateCaseChecks(c: CaseResult): Array<{
  rule: string;
  check: string;
  passed: number;
  total: number;
  failureDetails: string[];
}> {
  const keys: string[] = [];
  const buckets = new Map<string, { rule: string; check: string; passed: number; total: number; failureDetails: string[] }>();
  for (const t of c.trials) {
    for (const ck of t.checks) {
      const k = checkKey(ck);
      let b = buckets.get(k);
      if (!b) {
        b = { rule: ck.rule, check: ck.check, passed: 0, total: 0, failureDetails: [] };
        buckets.set(k, b);
        keys.push(k);
      }
      b.total += 1;
      if (ck.passed) b.passed += 1;
      else b.failureDetails.push(ck.detail);
    }
  }
  return keys.map((k) => buckets.get(k)!);
}

export function formatReport(result: RunResult, opts: FormatOptions = {}): string {
  const out: string[] = [];
  out.push(`agent: ${result.agent}`);
  if (result.meta) {
    const m = result.meta;
    const parts = [`via=${m.via}`];
    if (m.model) parts.push(`model=${m.model}`);
    if (m.judgeModel && m.judgeModel !== m.model) parts.push(`judge=${m.judgeModel}`);
    if (m.temperature !== null) parts.push(`temp=${m.temperature}`);
    parts.push(`at=${m.timestamp}`);
    out.push(parts.join(" "));
  }
  out.push("");

  for (const c of result.cases) {
    const trials = c.trials.length;
    const header = trials > 1 ? `case: ${c.name} (${trials} trials)` : `case: ${c.name}`;
    out.push(header);
    if (opts.verbose) {
      const firstOutput = c.trials[0]?.output ?? "";
      out.push("  output:");
      out.push(indent(firstOutput, "    | "));
      if (trials > 1) out.push(`    (showing trial 1 of ${trials})`);
      out.push("");
    }
    const agg = aggregateCaseChecks(c);
    for (const a of agg) {
      if (trials === 1) {
        const passed = a.passed === a.total;
        const status = passed ? "PASS" : "FAIL";
        const detail = passed ? "" : a.failureDetails[0] ?? "";
        out.push(`  [${a.rule}] ${a.check.padEnd(18)} ${status}  ${detail}`);
      } else {
        const pctVal = a.total > 0 ? Math.round((a.passed / a.total) * 100) : 0;
        const flag = pctVal === 100 ? "" : pctVal >= 75 ? "  ~" : "  \u2190 attention";
        const sample = a.failureDetails.length ? `  (e.g. ${a.failureDetails[0]})` : "";
        out.push(`  [${a.rule}] ${a.check.padEnd(18)} ${a.passed}/${a.total} (${pctVal}%)${flag}${sample}`);
      }
    }
    out.push("");
  }

  const byRule = adherenceByRule(result);

  out.push("adherence by rule:");
  const rules = [...byRule.keys()].sort();
  for (const r of rules) {
    const { passed, total } = byRule.get(r)!;
    const pctVal = total > 0 ? Math.round((passed / total) * 100) : 0;
    const flag = pctVal === 100 ? "" : pctVal >= 75 ? "  ~" : "  \u2190 attention";
    out.push(`  [${r}] ${passed}/${total} (${pctVal}%)${flag}`);
  }

  const defined = result.definedRules ?? [];
  const untested = defined.filter((id) => !byRule.has(id));
  if (untested.length) {
    out.push("");
    out.push(`untested rules (no fixture expectations): ${untested.map((r) => `[${r}]`).join(", ")}`);
  }
  out.push("");

  const totalChecks = [...byRule.values()].reduce((s, e) => s + e.total, 0);
  const totalPassed = [...byRule.values()].reduce((s, e) => s + e.passed, 0);
  const overallPct = totalChecks > 0 ? Math.round((totalPassed / totalChecks) * 100) : 0;
  out.push(`overall: ${totalPassed}/${totalChecks} (${overallPct}%)`);
  return out.join("\n");
}

export function overallPassed(result: RunResult): boolean {
  for (const c of result.cases) {
    for (const t of c.trials) {
      for (const ck of t.checks) if (!ck.passed) return false;
    }
  }
  return true;
}

export function overallPercentage(result: RunResult): number {
  const t = totals(result);
  return t.total > 0 ? Math.round((t.passed / t.total) * 100) : 0;
}

export function toJSON(result: RunResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

function pct({ passed, total }: RuleAdherence): number {
  return total > 0 ? Math.round((passed / total) * 100) : 0;
}

export interface BaselineDiff {
  rendered: string;
  regressedRules: string[];
}

export function formatBaselineDiff(current: RunResult, baseline: RunResult): BaselineDiff {
  const cur = adherenceByRule(current);
  const base = adherenceByRule(baseline);
  const allRules = new Set<string>([...cur.keys(), ...base.keys()]);
  const regressedRules: string[] = [];
  const lines: string[] = [];
  lines.push("current vs. baseline:");
  for (const rule of [...allRules].sort()) {
    const c = cur.get(rule);
    const b = base.get(rule);
    if (c && b) {
      const cp = pct(c);
      const bp = pct(b);
      const delta = cp - bp;
      const flag = delta < 0 ? "  \u2190 regression" : delta > 0 ? "  \u2713 improvement" : "";
      const sign = delta > 0 ? "+" : "";
      lines.push(
        `  [${rule}] ${b.passed}/${b.total} (${bp}%) \u2192 ${c.passed}/${c.total} (${cp}%)  ${sign}${delta}%${flag}`,
      );
      if (delta < 0) regressedRules.push(rule);
    } else if (c && !b) {
      lines.push(`  [${rule}] (new rule) ${c.passed}/${c.total} (${pct(c)}%)`);
    } else if (!c && b) {
      lines.push(`  [${rule}] (removed from fixtures) baseline was ${b.passed}/${b.total} (${pct(b)}%)`);
    }
  }
  const curTotals = totals(current);
  const baseTotals = totals(baseline);
  const curOverall = curTotals.total > 0 ? Math.round((curTotals.passed / curTotals.total) * 100) : 0;
  const baseOverall = baseTotals.total > 0 ? Math.round((baseTotals.passed / baseTotals.total) * 100) : 0;
  const overallDelta = curOverall - baseOverall;
  const sign = overallDelta > 0 ? "+" : "";
  lines.push("");
  lines.push(
    `overall: ${baseTotals.passed}/${baseTotals.total} (${baseOverall}%) \u2192 ${curTotals.passed}/${curTotals.total} (${curOverall}%)  ${sign}${overallDelta}%`,
  );
  return { rendered: lines.join("\n"), regressedRules };
}

function totals(result: RunResult): { passed: number; total: number } {
  let passed = 0;
  let total = 0;
  for (const c of result.cases) {
    for (const t of c.trials) {
      for (const ck of t.checks) {
        total += 1;
        if (ck.passed) passed += 1;
      }
    }
  }
  return { passed, total };
}

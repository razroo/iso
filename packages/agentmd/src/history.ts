import { readFileSync } from "node:fs";
import { adherenceByRule } from "./report.js";
import type { RunResult } from "./runner.js";

export interface HistoryEntry {
  path: string;
  result: RunResult;
}

export function loadHistory(paths: string[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const path of paths) {
    const raw = readFileSync(path, "utf8");
    const result = JSON.parse(raw) as RunResult;
    if (!result || !Array.isArray(result.cases)) {
      throw new Error(`${path}: not a RunResult JSON (missing "cases" array)`);
    }
    entries.push({ path, result });
  }
  entries.sort((a, b) => {
    const ta = a.result.meta?.timestamp ?? "";
    const tb = b.result.meta?.timestamp ?? "";
    return ta.localeCompare(tb);
  });
  return entries;
}

export interface HistoryOptions {
  ruleFilter?: string;
}

function pct(passed: number, total: number): number {
  return total > 0 ? Math.round((passed / total) * 100) : 0;
}

export function formatHistory(entries: HistoryEntry[], opts: HistoryOptions = {}): string {
  if (!entries.length) return "no reports found\n";
  const perRule = entries.map((e) => ({
    entry: e,
    byRule: adherenceByRule(e.result),
  }));

  const ruleSet = new Set<string>();
  for (const p of perRule) for (const r of p.byRule.keys()) ruleSet.add(r);
  let rules = [...ruleSet].sort();
  if (opts.ruleFilter) rules = rules.filter((r) => r === opts.ruleFilter);

  const out: string[] = [];
  out.push(`reports: ${entries.length}`);
  for (const e of entries) {
    const ts = e.result.meta?.timestamp ?? "(no timestamp)";
    const model = e.result.meta?.model ?? "?";
    out.push(`  ${ts}  ${model}  ${e.path}`);
  }
  out.push("");

  if (!rules.length) {
    out.push(opts.ruleFilter ? `no data for rule [${opts.ruleFilter}]` : "no rules measured");
    return out.join("\n") + "\n";
  }

  out.push("adherence trend:");
  for (const rule of rules) {
    const points = perRule.map(({ byRule }) => {
      const v = byRule.get(rule);
      return v ? pct(v.passed, v.total) : null;
    });
    const rendered = points.map((p) => (p === null ? "  -" : `${p}%`.padStart(4))).join(" \u2192 ");
    const last = points.filter((p): p is number => p !== null);
    const delta = last.length >= 2 ? last[last.length - 1] - last[0] : 0;
    const sign = delta > 0 ? "+" : "";
    const deltaStr = last.length >= 2 ? `  (${sign}${delta}%)` : "";
    out.push(`  [${rule}] ${rendered}${deltaStr}`);
  }
  out.push("");

  const overalls = perRule.map(({ byRule }) => {
    let passed = 0;
    let total = 0;
    for (const v of byRule.values()) {
      passed += v.passed;
      total += v.total;
    }
    return pct(passed, total);
  });
  const overallDelta = overalls.length >= 2 ? overalls[overalls.length - 1] - overalls[0] : 0;
  const sign = overallDelta > 0 ? "+" : "";
  out.push(
    `overall: ${overalls.map((p) => `${p}%`).join(" \u2192 ")}${
      overalls.length >= 2 ? `  (${sign}${overallDelta}%)` : ""
    }`,
  );
  return out.join("\n") + "\n";
}

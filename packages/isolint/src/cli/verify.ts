/**
 * `isolint verify` — real-model empirical bridge
 * ----------------------------------------------
 * Runs a harness through a real (small) model before and after fix, then
 * compares outputs. Bridges the deterministic simulator's codified failure
 * modes to whatever model the user actually targets.
 *
 * Usage:
 *   isolint verify --harness modes/classify.md --input test.json --small mistralai/mistral-7b-instruct
 *
 * Outputs a structured report:
 *   - before:  raw model output for unfixed harness
 *   - after:   raw model output for fixed harness
 *   - diff:    behavioral changes (length, JSON-validity, etc.)
 *
 * This is a behavioral probe, not a unit test — the same run can return
 * different outputs. Use it to sanity-check that rewrites move the needle
 * on your actual target model.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLint } from "../lint/runner.js";
import { computeFixes } from "../lint/fix.js";
import { loadConfig } from "../lint/config.js";
import { PERFORMANCE_RULES } from "../lint/rules/performance.js";
import { tokenizeSentences } from "../lint/sentences.js";
import { computeSkipIntervals } from "../lint/source.js";
import type { ModelProvider, CompletionResponse } from "../providers/types.js";
import { simulate } from "../sim/simulator.js";

export interface VerifyOptions {
  harness_path: string;
  input_path: string;
  model: ModelProvider;
  fixModel: ModelProvider;
  cwd: string;
}

export interface VerifyReport {
  harness: string;
  before: { output: string; usage: CompletionResponse["usage"] };
  after: { output: string; usage: CompletionResponse["usage"]; applied_fixes: number };
  simulator: {
    before: { failed: number; followed: number; fragility: number };
    after: { failed: number; followed: number; fragility: number };
  };
  diff: {
    char_delta: number;
    json_valid_before: boolean;
    json_valid_after: boolean;
    identical: boolean;
  };
  performance: {
    before: HarnessPerformanceMetrics;
    after: HarnessPerformanceMetrics;
    diff: {
      char_delta: number;
      word_delta: number;
      approx_token_delta: number;
      sentence_delta: number;
      finding_delta: number;
      by_rule: Record<string, number>;
    };
  };
}

export interface HarnessPerformanceMetrics {
  chars: number;
  words: number;
  approx_tokens: number;
  sentences: number;
  findings: number;
  by_rule: Record<string, number>;
}

function tryParseJson(s: string): boolean {
  try {
    JSON.parse(s.trim());
    return true;
  } catch {
    // Also accept JSON wrapped in a ```json fence.
    const m = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(s);
    if (!m) return false;
    try {
      JSON.parse(m[1]);
      return true;
    } catch {
      return false;
    }
  }
}

async function runHarness(
  model: ModelProvider,
  harness: string,
  input: string,
): Promise<{ output: string; usage: CompletionResponse["usage"] }> {
  const res = await model.complete({
    messages: [
      { role: "system", content: harness },
      { role: "user", content: input },
    ],
    temperature: 0,
    max_tokens: 2048,
  });
  return { output: res.content, usage: res.usage };
}

export async function verify(opts: VerifyOptions): Promise<VerifyReport> {
  const absHarness = resolve(opts.cwd, opts.harness_path);
  const absInput = resolve(opts.cwd, opts.input_path);
  const harnessSource = readFileSync(absHarness, "utf8");
  const inputSource = readFileSync(absInput, "utf8");

  const config = loadConfig(opts.cwd);

  // Lint + fix the harness in memory.
  const lintReport = await runLint(
    [{ rel_path: opts.harness_path, source: harnessSource }],
    config,
  );
  const perfBefore = await computeHarnessPerformance(opts.harness_path, harnessSource, config);
  const fixReport = await computeFixes(
    [{ rel_path: opts.harness_path, source: harnessSource }],
    lintReport.findings,
    { use_llm: true, model: opts.fixModel, config, samples_per_attempt: 1 },
  );
  const fixedHarness = fixReport.files[0]?.fixed ?? harnessSource;
  const perfAfter = await computeHarnessPerformance(opts.harness_path, fixedHarness, config);

  // Run both versions against the target model in parallel.
  const [before, after] = await Promise.all([
    runHarness(opts.model, harnessSource, inputSource),
    runHarness(opts.model, fixedHarness, inputSource),
  ]);

  // Compare.
  const simBefore = simulate(harnessSource);
  const simAfter = simulate(fixedHarness);

  return {
    harness: opts.harness_path,
    before,
    after: { ...after, applied_fixes: fixReport.applied_total },
    simulator: {
      before: { failed: simBefore.failed, followed: simBefore.followed, fragility: simBefore.fragility },
      after: { failed: simAfter.failed, followed: simAfter.followed, fragility: simAfter.fragility },
    },
    diff: {
      char_delta: after.output.length - before.output.length,
      json_valid_before: tryParseJson(before.output),
      json_valid_after: tryParseJson(after.output),
      identical: before.output === after.output,
    },
    performance: {
      before: perfBefore,
      after: perfAfter,
      diff: {
        char_delta: perfAfter.chars - perfBefore.chars,
        word_delta: perfAfter.words - perfBefore.words,
        approx_token_delta: perfAfter.approx_tokens - perfBefore.approx_tokens,
        sentence_delta: perfAfter.sentences - perfBefore.sentences,
        finding_delta: perfAfter.findings - perfBefore.findings,
        by_rule: diffRuleCounts(perfBefore.by_rule, perfAfter.by_rule),
      },
    },
  };
}

export function formatVerifyReport(r: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`harness: ${r.harness}`);
  lines.push(``);
  lines.push(`SIMULATOR (deterministic)`);
  lines.push(`  before: failed=${r.simulator.before.failed} followed=${r.simulator.before.followed} fragility=${r.simulator.before.fragility.toFixed(2)}`);
  lines.push(`  after:  failed=${r.simulator.after.failed} followed=${r.simulator.after.followed} fragility=${r.simulator.after.fragility.toFixed(2)}`);
  lines.push(``);
  lines.push(`HARNESS PERFORMANCE`);
  lines.push(`  chars:               ${r.performance.before.chars} -> ${r.performance.after.chars} (${signed(r.performance.diff.char_delta)})`);
  lines.push(`  words:               ${r.performance.before.words} -> ${r.performance.after.words} (${signed(r.performance.diff.word_delta)})`);
  lines.push(`  approx prompt toks:  ${r.performance.before.approx_tokens} -> ${r.performance.after.approx_tokens} (${signed(r.performance.diff.approx_token_delta)})`);
  lines.push(`  sentences:           ${r.performance.before.sentences} -> ${r.performance.after.sentences} (${signed(r.performance.diff.sentence_delta)})`);
  lines.push(`  perf findings:       ${r.performance.before.findings} -> ${r.performance.after.findings} (${signed(r.performance.diff.finding_delta)})`);
  for (const [rule, delta] of Object.entries(r.performance.diff.by_rule).sort((a, b) => a[0].localeCompare(b[0]))) {
    const before = r.performance.before.by_rule[rule] ?? 0;
    const afterCount = r.performance.after.by_rule[rule] ?? 0;
    lines.push(`  ${rule}: ${before} -> ${afterCount} (${signed(delta)})`);
  }
  lines.push(``);
  lines.push(`REAL MODEL (applied ${r.after.applied_fixes} fix${r.after.applied_fixes === 1 ? "" : "es"})`);
  lines.push(`  output char delta:  ${r.diff.char_delta >= 0 ? "+" : ""}${r.diff.char_delta}`);
  lines.push(`  JSON valid before:  ${r.diff.json_valid_before}`);
  lines.push(`  JSON valid after:   ${r.diff.json_valid_after}`);
  lines.push(`  outputs identical:  ${r.diff.identical}`);
  lines.push(``);
  lines.push(`--- BEFORE ---`);
  lines.push(r.before.output);
  lines.push(``);
  lines.push(`--- AFTER ---`);
  lines.push(r.after.output);
  return lines.join("\n");
}

async function computeHarnessPerformance(
  path: string,
  source: string,
  config: ReturnType<typeof loadConfig>,
): Promise<HarnessPerformanceMetrics> {
  const skips = computeSkipIntervals(source, config.skip_spans);
  const sentences = tokenizeSentences(source, skips)
    .filter((sentence) => {
      const text = sentence.text.trim();
      return text.length > 0 && !/^[#>*+\-|]/.test(text);
    });
  const perfLint = await runLint(
    [{ rel_path: path, source }],
    config,
    { rules: PERFORMANCE_RULES },
  );
  const byRule: Record<string, number> = {};
  for (const finding of perfLint.findings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] ?? 0) + 1;
  }
  const chars = source.length;
  const words = source.match(/[A-Za-z0-9$_.-]+/g)?.length ?? 0;
  return {
    chars,
    words,
    approx_tokens: Math.ceil(chars / 4),
    sentences: sentences.length,
    findings: perfLint.findings.length,
    by_rule: byRule,
  };
}

function diffRuleCounts(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Record<string, number> = {};
  for (const key of keys) {
    const delta = (after[key] ?? 0) - (before[key] ?? 0);
    if (delta !== 0 || (before[key] ?? 0) > 0 || (after[key] ?? 0) > 0) out[key] = delta;
  }
  return out;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

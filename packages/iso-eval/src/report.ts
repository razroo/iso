import type { EvalReport, TaskResult } from "./types.js";

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`suite:    ${report.suite}`);
  lines.push(`runner:   ${report.runner}`);
  lines.push(`duration: ${report.durationMs}ms`);
  lines.push("");
  for (const t of report.tasks) lines.push(formatTask(t));
  const total = report.tasks.length;
  const passed = report.tasks.filter((t) => t.passed).length;
  lines.push("");
  lines.push(
    `${passed}/${total} tasks passed — ${report.passed ? "PASS" : "FAIL"}`,
  );
  return lines.join("\n");
}

function formatTask(t: TaskResult): string {
  const marker = t.passed ? "✓" : "✗";
  const trialSuffix = t.trials.length > 1 ? ` (${t.trials.length} trials)` : "";
  const out: string[] = [`${marker} ${t.id}${trialSuffix}`];
  for (let i = 0; i < t.trials.length; i++) {
    const trial = t.trials[i];
    const trialHeader =
      t.trials.length > 1 ? `  trial ${i + 1}: ${trial.passed ? "pass" : "fail"}` : null;
    if (trialHeader) out.push(trialHeader);
    for (const c of trial.checks) {
      const m = c.passed ? "✓" : "✗";
      const indent = t.trials.length > 1 ? "    " : "  ";
      out.push(`${indent}${m} [${c.check.type}] ${c.detail}`);
    }
  }
  return out.join("\n");
}

export function toJSON(report: EvalReport): string {
  return JSON.stringify(report, null, 2);
}

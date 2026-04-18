import type { FixReport } from "./fix.js";
import type { LintReport, Severity } from "./types.js";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  bold: "\x1b[1m",
};

function sevColor(s: Severity): string {
  return s === "error" ? COLORS.red : s === "warn" ? COLORS.yellow : COLORS.cyan;
}

function sevLabel(s: Severity): string {
  return s === "error" ? "error" : s === "warn" ? "warn " : "info ";
}

export function formatText(report: LintReport, opts: { color?: boolean } = {}): string {
  const color = opts.color ?? process.stdout.isTTY ?? false;
  const paint = (c: string, s: string) => (color ? `${c}${s}${COLORS.reset}` : s);

  const byFile = groupBy(report.findings, (f) => f.file);
  const lines: string[] = [];

  for (const [file, findings] of byFile) {
    lines.push("");
    lines.push(paint(COLORS.bold, file));
    let lastSection: string | undefined;
    for (const f of findings) {
      if (f.section && f.section !== lastSection) {
        lines.push(paint(COLORS.dim, `  § ${f.section}`));
        lastSection = f.section;
      }
      const loc = `${f.range.line}:${f.range.column}`.padEnd(7);
      const sev = paint(sevColor(f.severity), sevLabel(f.severity));
      const rule = paint(COLORS.dim, f.rule_id.padEnd(28));
      lines.push(`  ${loc} ${sev} ${rule} ${f.message}`);
      if (f.sentence && f.sentence.length <= 200 && f.sentence !== f.snippet) {
        lines.push(paint(COLORS.dim, `           in: "${f.sentence}"`));
      }
    }
  }

  lines.push("");
  const parts: string[] = [];
  if (report.errors > 0) parts.push(paint(COLORS.red, `${report.errors} error${s(report.errors)}`));
  if (report.warnings > 0) parts.push(paint(COLORS.yellow, `${report.warnings} warning${s(report.warnings)}`));
  if (report.infos > 0) parts.push(paint(COLORS.cyan, `${report.infos} info${s(report.infos)}`));
  const summary =
    parts.length === 0
      ? paint(COLORS.green, "no findings")
      : parts.join(", ");
  lines.push(`${report.files_scanned} file${s(report.files_scanned)} scanned — ${summary}`);
  return lines.join("\n");
}

export function formatJSON(report: LintReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatSARIF(report: LintReport): string {
  const rulesSet = new Set(report.findings.map((f) => f.rule_id));
  const rules = [...rulesSet].map((id) => ({
    id,
    name: id,
    shortDescription: { text: id },
    defaultConfiguration: { level: "warning" as const },
  }));
  const results = report.findings.map((f) => ({
    ruleId: f.rule_id,
    level:
      f.severity === "error" ? "error" : f.severity === "warn" ? "warning" : "note",
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.file },
          region: {
            startLine: f.range.line,
            startColumn: f.range.column,
            endLine: f.range.end_line ?? f.range.line,
            endColumn: f.range.end_column ?? f.range.column,
          },
        },
      },
    ],
  }));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "isolint",
            informationUri: "https://github.com/razroo/isolint",
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export function formatFixSummary(report: FixReport, opts: { color?: boolean } = {}): string {
  const color = opts.color ?? process.stdout.isTTY ?? false;
  const paint = (c: string, s: string) => (color ? `${c}${s}${COLORS.reset}` : s);
  const changedFiles = report.files.filter((f) => f.changed);
  const lines: string[] = [];
  for (const f of changedFiles) {
    lines.push(paint(COLORS.bold, f.rel_path) + `  ${f.applied} fix${plural(f.applied)} applied`);
  }

  if (report.rewrite_skips.length > 0) {
    lines.push("");
    lines.push(paint(COLORS.yellow, `⚠  ${report.rewrite_skips.length} rewrite${plural(report.rewrite_skips.length)} rejected by validator:`));
    for (const skip of report.rewrite_skips) {
      lines.push(paint(COLORS.dim, `   ${skip.file}`) + `  [${skip.rule_ids.join(", ")}]`);
      lines.push(paint(COLORS.dim, `     sentence: "${truncate(skip.sentence, 80)}"`));
      for (const p of skip.problems.slice(0, 3)) {
        lines.push(paint(COLORS.dim, `     why: ${p}`));
      }
    }
  }

  lines.push("");
  if (report.applied_total === 0 && report.rewrite_skips.length === 0) {
    lines.push(
      paint(COLORS.dim, "no fixes applied (rerun with --llm to enable LLM rewrites for flagged spans)"),
    );
  } else if (report.applied_total === 0) {
    lines.push(paint(COLORS.yellow, "no fixes applied — every rewrite was rejected by the validator"));
  } else {
    lines.push(
      `${changedFiles.length} file${plural(changedFiles.length)} changed — ${report.applied_total} total fix${plural(report.applied_total)}`,
    );
  }
  return lines.join("\n");
}

export function formatRuleStats(report: FixReport, opts: { color?: boolean } = {}): string {
  const color = opts.color ?? process.stdout.isTTY ?? false;
  const paint = (c: string, s: string) => (color ? `${c}${s}${COLORS.reset}` : s);
  const entries = Object.entries(report.rule_stats)
    .filter(([, s]) => s.candidates > 0)
    .sort((a, b) => b[1].candidates - a[1].candidates);
  if (entries.length === 0) return paint(COLORS.dim, "no rewrite attempts recorded");
  const lines: string[] = [];
  const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
  const padL = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);
  lines.push(
    paint(COLORS.bold, pad("rule", 30)) +
      "  " + paint(COLORS.bold, padL("cand", 5)) +
      "  " + paint(COLORS.bold, padL("ok₁", 5)) +
      "  " + paint(COLORS.bold, padL("okᵣ", 5)) +
      "  " + paint(COLORS.bold, padL("rej", 5)) +
      "  " + paint(COLORS.bold, padL("accept%", 7)),
  );
  for (const [id, s] of entries) {
    const accepted = s.accepted_first_try + s.accepted_after_retry;
    const attempted = accepted + s.rejected + s.empty_or_unchanged;
    const pct = attempted === 0 ? "—" : Math.round((accepted / attempted) * 100) + "%";
    const pctColor = attempted === 0 ? COLORS.dim : accepted / attempted >= 0.75 ? COLORS.green : accepted / attempted >= 0.4 ? COLORS.yellow : COLORS.red;
    lines.push(
      pad(id, 30) +
        "  " + padL(String(s.candidates), 5) +
        "  " + padL(String(s.accepted_first_try), 5) +
        "  " + padL(String(s.accepted_after_retry), 5) +
        "  " + padL(String(s.rejected), 5) +
        "  " + paint(pctColor, padL(pct, 7)),
    );
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function plural(n: number): string {
  return n === 1 ? "" : "es"; // "fix" → "fixes"
}

export function unifiedDiff(
  file: string,
  original: string,
  fixed: string,
  ctx = 3,
): string {
  if (original === fixed) return "";
  const a = original.split("\n");
  const b = fixed.split("\n");
  const hunks = diffHunks(a, b, ctx);
  if (hunks.length === 0) return "";
  const out: string[] = [];
  out.push(`--- a/${file}`);
  out.push(`+++ b/${file}`);
  for (const h of hunks) {
    out.push(`@@ -${h.aStart + 1},${h.aLines} +${h.bStart + 1},${h.bLines} @@`);
    for (const line of h.lines) out.push(line);
  }
  return out.join("\n") + "\n";
}

interface Hunk {
  aStart: number;
  aLines: number;
  bStart: number;
  bLines: number;
  lines: string[];
}

function diffHunks(a: string[], b: string[], ctx: number): Hunk[] {
  const ops = myersDiff(a, b);
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "eq") {
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length) {
      if (ops[j].kind !== "eq") {
        j++;
        continue;
      }
      let run = 0;
      let k = j;
      while (k < ops.length && ops[k].kind === "eq") {
        run++;
        k++;
      }
      if (run >= ctx * 2 || k === ops.length) break;
      j = k;
    }
    const ctxStart = Math.max(i - ctx, 0);
    const ctxEnd = Math.min(j + ctx, ops.length);
    const hunkOps = ops.slice(ctxStart, ctxEnd);
    const aStart = hunkOps.findIndex((o) => o.aIdx >= 0);
    const bStart = hunkOps.findIndex((o) => o.bIdx >= 0);
    let aLines = 0;
    let bLines = 0;
    const lines: string[] = [];
    for (const op of hunkOps) {
      if (op.kind === "eq") {
        lines.push(" " + op.value);
        aLines++;
        bLines++;
      } else if (op.kind === "del") {
        lines.push("-" + op.value);
        aLines++;
      } else {
        lines.push("+" + op.value);
        bLines++;
      }
    }
    hunks.push({
      aStart: hunkOps[aStart]?.aIdx ?? 0,
      aLines,
      bStart: hunkOps[bStart]?.bIdx ?? 0,
      bLines,
      lines,
    });
    i = ctxEnd;
  }
  return hunks;
}

interface DiffOp {
  kind: "eq" | "del" | "add";
  value: string;
  aIdx: number;
  bIdx: number;
}

/** Minimal LCS-based diff. Good enough for file-sized inputs. */
function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "eq", value: a[i], aIdx: i, bIdx: j });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "del", value: a[i], aIdx: i, bIdx: -1 });
      i++;
    } else {
      ops.push({ kind: "add", value: b[j], aIdx: -1, bIdx: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "del", value: a[i], aIdx: i, bIdx: -1 });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "add", value: b[j], aIdx: -1, bIdx: j });
    j++;
  }
  return ops;
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of arr) {
    const k = key(t);
    const list = out.get(k) ?? [];
    list.push(t);
    out.set(k, list);
  }
  return out;
}

function s(n: number): string {
  return n === 1 ? "" : "s";
}

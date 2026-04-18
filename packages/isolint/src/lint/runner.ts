import type { ModelProvider } from "../providers/types.js";
import { DEFAULT_CONFIG } from "./config.js";
import { ALL_RULES, rulesFromPresets } from "./preset.js";
import { compileCustomRules } from "./rules/custom.js";
import { annotateAndFilter } from "./sections.js";
import { computeLineStarts, computeSkipIntervals } from "./source.js";
import { applySuppressions } from "./suppressions.js";
import type {
  LintContext,
  LintFinding,
  LintReport,
  ResolvedConfig,
  Rule,
  Severity,
} from "./types.js";

export interface LintInputFile {
  rel_path: string;
  source: string;
}

export interface RunnerOptions {
  /** Override/extend the preset ruleset. */
  rules?: Rule[];
  /** If true, run LLM-tier rules too. Requires model. */
  llm?: boolean;
  /** Provider used for LLM rules. Required when llm=true. */
  model?: ModelProvider;
  /** Override severity threshold for exit-code purposes. */
  fail_on?: Severity;
  /**
   * Repo-relative file paths known to exist in the repo. Passed to every
   * LintContext so rules like `missing-file-reference` can check refs.
   */
  repo_files?: ReadonlySet<string>;
}

/**
 * Run the configured ruleset against every file. Pure: does not read
 * the filesystem — feed it DiscoveredFile[] from the scanner.
 */
export async function runLint(
  files: LintInputFile[],
  config: ResolvedConfig = DEFAULT_CONFIG,
  opts: RunnerOptions = {},
): Promise<LintReport> {
  const presetRules = opts.rules ?? rulesFromPresets(config.extends ?? ["recommended", "performance"]);
  const reservedIds = new Set(ALL_RULES.map((r) => r.id));
  const customRules = compileCustomRules(config.custom_rules ?? [], reservedIds);
  const allRules = [...presetRules, ...customRules];
  const activeRules = selectActiveRules(allRules, config, opts);

  const findings: LintFinding[] = [];
  const sourceByFile = new Map<string, string>();
  for (const f of files) sourceByFile.set(f.rel_path, f.source);

  // Aggregate Step/Block heading defs across the whole scan so
  // `undefined-step-reference` doesn't fire when a ref lives in a sibling file.
  const repoHeadings = new Set<string>();
  const headingRe = /^#{1,6}\s+(Step|Block)\s+([A-Z0-9]+)\b/gm;
  for (const f of files) {
    for (const m of f.source.matchAll(headingRe)) {
      repoHeadings.add(`${m[1].toLowerCase()}:${m[2].toUpperCase()}`);
    }
  }

  for (const file of files) {
    const ctx: LintContext = {
      source: file.source,
      file: file.rel_path,
      line_starts: computeLineStarts(file.source),
      config,
      repo_sources: sourceByFile,
      repo_headings: repoHeadings,
      ...(opts.repo_files ? { repo_files: opts.repo_files } : {}),
    };
    for (const rule of activeRules) {
      const override = config.rules[rule.id];
      if (override === "off") continue;
      try {
        const raw = rule.tier === "llm"
          ? rule.checkLLM && opts.model
            ? await rule.checkLLM(ctx, opts.model)
            : []
          : rule.check?.(ctx) ?? [];
        for (const f of raw) {
          // Severity precedence: explicit config override > finding's own
          // severity (e.g. context-budget escalates to warn dynamically) >
          // rule's declared default.
          const severity: Severity = (override as Severity | undefined) ?? f.severity ?? rule.severity;
          findings.push({ ...f, severity });
        }
      } catch {
        // Rules are sandboxed: one bad rule never kills the whole run.
      }
    }
  }

  // Enrich findings with section + containing sentence; apply section_severity.
  const skipsByFile = new Map<string, [number, number][]>();
  for (const [file, source] of sourceByFile) {
    skipsByFile.set(file, computeSkipIntervals(source, config.skip_spans));
  }
  const annotated = annotateAndFilter(findings, sourceByFile, skipsByFile, config);

  const filtered = applySuppressions(annotated, sourceByFile);

  const errors = filtered.filter((f) => f.severity === "error").length;
  const warnings = filtered.filter((f) => f.severity === "warn").length;
  const infos = filtered.filter((f) => f.severity === "info").length;

  return { files_scanned: files.length, findings: filtered, errors, warnings, infos };
}

function selectActiveRules(
  rules: Rule[],
  config: ResolvedConfig,
  opts: RunnerOptions,
): Rule[] {
  const out: Rule[] = [];
  for (const rule of rules) {
    if (config.rules[rule.id] === "off") continue;
    if (rule.tier === "llm" && !opts.llm) continue;
    out.push(rule);
  }
  return out;
}

export function exitCodeFor(report: LintReport, threshold: Severity = "error"): number {
  if (threshold === "error") return report.errors > 0 ? 1 : 0;
  if (threshold === "warn") return report.errors + report.warnings > 0 ? 1 : 0;
  return report.errors + report.warnings + report.infos > 0 ? 1 : 0;
}

/**
 * Isomodel Linter - Core types
 * ----------------------------
 * Lints markdown (and other prose) harness files for patterns that
 * break weak models (Minimax 2.5, Nemotron 3, Mistral 7B, local models).
 *
 * Two tiers:
 *  - Tier 1: deterministic regex / AST checks. Zero cost, runs in CI.
 *  - Tier 2: LLM-assisted checks using Isomodel Plans. Opt-in, costs tokens.
 */

import type { ModelProvider } from "../providers/types.js";

export type Severity = "error" | "warn" | "info";

export type RuleTier = "deterministic" | "llm";

export interface SourceRange {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** Inclusive end line. */
  end_line?: number;
  end_column?: number;
}

export interface LintFinding {
  rule_id: string;
  severity: Severity;
  file: string;
  range: SourceRange;
  /** Short, human-actionable message (<=200 chars). */
  message: string;
  /** The exact source snippet that triggered the finding. */
  snippet: string;
  /**
   * The containing sentence, if the source has one. Reporters display this
   * as extra context; LLM rewriters use it as the fix span. Trimmed.
   */
  sentence?: string;
  /**
   * The nearest preceding heading text (e.g. "Step 3 — Classify"), or the
   * file-level title. Empty when the finding precedes any heading.
   */
  section?: string;
  /**
   * Optional deterministic autofix. Present only when the rule can
   * rewrite safely without a model in the loop.
   */
  fix?: Fix;
  /** If true, the finding can be fixed by the LLM rewriter (--fix). */
  llm_fixable?: boolean;
}

export interface Fix {
  /** Character offset (0-based) into the original file. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Replacement text. */
  replacement: string;
  /** Short description of what the fix does. */
  description: string;
}

export interface LintContext {
  /** Full file contents. */
  source: string;
  /** Repo-relative path. */
  file: string;
  /** Line starts (0-based offsets) - provided for cheap line/col math. */
  line_starts: number[];
  /** Resolved config for this file. */
  config: ResolvedConfig;
  /**
   * Set of repo-relative file paths known to exist. Populated when the
   * scanner is run against a repo; empty when running against a single file
   * or when the runner has no repo context. Rules that check cross-file
   * references (e.g. `missing-file-reference`) consult this set.
   */
  repo_files?: ReadonlySet<string>;
  /**
   * Source text for every file in the current lint set. Populated when the
   * runner lints multiple files so cross-file performance rules can compare
   * mirrored specs or shared boilerplate without re-reading the filesystem.
   */
  repo_sources?: ReadonlyMap<string, string>;
  /**
   * Step/Block identifiers defined in ANY file under lint (e.g. "step:3",
   * "block:A"). Rules like `undefined-step-reference` use this so a ref to
   * "Block A" in one mode counts as defined if `_shared.md` declares it.
   */
  repo_headings?: ReadonlySet<string>;
}

export interface RuleExample {
  /** Prose that would trip this rule. */
  bad: string;
  /** A known-good rewrite of `bad` that passes validation. */
  good: string;
  /** Short explanation included in the rewrite prompt. */
  why: string;
  /**
   * Optional repo-relative path for the example when the rule is path-gated
   * (e.g. `frontmatter-schema` only fires on `.claude/agents/*.md`). Default
   * `modes/example.md` — good for most harness rules.
   */
  path?: string;
}

export interface Rule {
  id: string;
  tier: RuleTier;
  severity: Severity;
  /** One-line description. */
  description: string;
  /**
   * Canonical bad → good examples. Included in the rewrite prompt when this
   * rule's violation is the dominant one in a sentence being fixed. Grounds
   * the model instead of hoping it guesses the intent.
   */
  examples?: RuleExample[];
  /**
   * Synchronous deterministic check. Required for tier="deterministic".
   * LLM-tier rules leave this undefined and implement `checkLLM`.
   */
  check?: (ctx: LintContext) => LintFinding[];
  /**
   * Async LLM-powered check. Required for tier="llm".
   * Receives a ModelProvider so the rule can run an Isomodel Plan.
   */
  checkLLM?: (ctx: LintContext, model: ModelProvider) => Promise<LintFinding[]>;
}

export interface RulePreset {
  id: string;
  description: string;
  rules: Rule[];
}

export interface CustomRuleSpec {
  /** Must be unique and not collide with a built-in rule id. */
  id: string;
  /** Regex source, without surrounding slashes. */
  pattern: string;
  /** Regex flags. Defaults to "gi". `g` is always added if missing. */
  flags?: string;
  /** Defaults to "warn". */
  severity?: Severity;
  /** Shown to the user when the rule fires. */
  message: string;
}

export interface ResolvedConfig {
  /** Enabled rule ids. Unknown ids are ignored with a warning. */
  rules: Record<string, Severity | "off">;
  /** Additional glob patterns to ignore on top of built-in defaults. */
  ignore: string[];
  /** Rule-specific options (banned words, max sentence length, etc.). */
  options: Record<string, unknown>;
  /** Extend one or more presets (applied left-to-right before `rules`). */
  extends: string[];
  /** Team-defined regex rules loaded at runtime from `.isolint.json`. */
  custom_rules: CustomRuleSpec[];
  /**
   * Override severity by section heading. Keys are matched case-insensitively
   * against the section name. Useful for muting rules inside `Examples`,
   * `Notes`, or `Changelog` sections.
   */
  section_severity: Record<string, Severity | "off">;
  /**
   * Patterns inside files that should be treated as "code blocks to skip".
   * Defaults to fenced code blocks and inline code spans.
   */
  skip_spans: {
    fenced_code: boolean;
    inline_code: boolean;
    html_comments: boolean;
    /**
     * Skip content inside short double-quoted phrases (≤ quoted_strings_max_chars).
     * In markdown prose, `"leveraged"`, `"cutting-edge"`, etc. are typically being
     * *named* (example, banned word, literal output) rather than *used*, so the
     * rule should not fire on words inside them.
     */
    quoted_strings: boolean;
    /** Max length of quoted content to treat as a skip span (default 40). */
    quoted_strings_max_chars: number;
    /**
     * Skip YAML (`---`) or TOML (`+++`) frontmatter at the start of a file.
     * Opencode modes, Claude Code agents, and Cursor `.mdc` rules all use this;
     * the content is structured metadata, not prose instructions.
     */
    frontmatter: boolean;
    /**
     * Skip contiguous `>` blockquote paragraphs. Blockquotes usually hold
     * example inputs/outputs or user-supplied prose, not harness instructions.
     */
    blockquotes: boolean;
  };
}

export interface LintReport {
  files_scanned: number;
  findings: LintFinding[];
  errors: number;
  warnings: number;
  infos: number;
}

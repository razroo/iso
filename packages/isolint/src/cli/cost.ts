/**
 * `isolint cost` — estimate per-turn prompt-token overhead of a harness.
 *
 * Shared-prefix files belong to distinct *tool load groups*: Claude Code
 * loads CLAUDE.md, the AGENTS.md convention (opencode / Codex / Zed) loads
 * AGENTS.md plus modes/_shared.md, Cursor loads .cursor/rules/*.mdc.
 * You pay ONE group's bundle per turn, not all of them summed together.
 *
 * iso/instructions.md is authoring source — at build time it compiles into
 * the tool-specific files. When a tool's file isn't tracked in the repo,
 * iso/instructions.md stands in as the content stand-in for that tool.
 *
 * Per-mode and per-agent files load conditionally and get their own
 * buckets.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { collectHeadings, type HeadingInfo } from "../lint/ast.js";
import {
  AGENT_PATH_RE,
  MODE_PATH_RE,
  SHARED_PREFIX_PATH_RE,
} from "../lint/paths.js";
import type { DiscoveredFile } from "../lint/scanner.js";

export interface SectionCost {
  title: string;
  words: number;
  approx_tokens: number;
}

export interface FileCost {
  path: string;
  words: number;
  approx_tokens: number;
  sections?: SectionCost[];
}

export interface ToolGroup {
  id: string;
  name: string;
  /** Files this tool loads on every turn. */
  files: FileCost[];
  approx_tokens: number;
  words: number;
  /** Explanation displayed after the group — e.g. "iso stands in for CLAUDE.md". */
  note?: string;
}

export interface CostReport {
  tools: ToolGroup[];
  modes: FileCost[];
  agents: FileCost[];
  /** Per-turn worst case: the most expensive tool's load. */
  worst_tool_tokens: number;
  worst_tool_words: number;
  worst_tool: ToolGroup | null;
  heaviest_mode: FileCost | null;
  heaviest_agent: FileCost | null;
  /** All shared-prefix files, deduped. Useful for the file-level breakdown. */
  shared_prefix: FileCost[];
  /**
   * Back-compat with v1.2.0: before the per-tool split this was the naive
   * sum across all shared-prefix files (wrong for multi-tool repos).
   * Preserved so existing JSON consumers don't crash, but
   * `worst_tool_tokens` is what you actually want.
   * @deprecated — use worst_tool_tokens instead.
   */
  shared_prefix_total_tokens: number;
  /** @deprecated — use worst_tool_words instead. */
  shared_prefix_total_words: number;
}

const WORD_RE = /[A-Za-z0-9$_.-]+/g;
const FRONTMATTER_RE = /^(?:\+\+\+\n[\s\S]*?\n\+\+\+\n?|---\n[\s\S]*?\n---\n?)/;

const CLAUDE_FILE_RE = /^CLAUDE\.md$/i;
const AGENTS_MD_RE = /^AGENTS(?:\.[^/]+)?\.md$/i;
const OPENCODE_INSTR_RE = /^\.opencode\/instructions\.md$/i;
const OPENCODE_SHARED_MODE_RE = /^modes\/_shared\.md$/i;
const CURSOR_RULE_RE = /^\.cursor\/rules\/[^/]+\.mdc$/i;
const ISO_SOURCE_RE = /^iso\/instructions\.md$/i;

const parser = unified().use(remarkParse);

function stripFrontmatter(source: string): string {
  return source.replace(FRONTMATTER_RE, "");
}

function wordCount(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fileCost(path: string, source: string, withSections: boolean): FileCost {
  const body = stripFrontmatter(source);
  const cost: FileCost = {
    path,
    words: wordCount(body),
    approx_tokens: approxTokens(body),
  };
  if (withSections) {
    const ast = parser.parse(source) as Root;
    const headings = collectHeadings(ast);
    if (headings.length > 0) {
      cost.sections = sectionCosts(source, headings);
    }
  }
  return cost;
}

function sectionCosts(source: string, headings: HeadingInfo[]): SectionCost[] {
  const out: SectionCost[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = headings[i + 1]?.start_offset ?? source.length;
    const body = source.slice(h.end_offset, end);
    out.push({
      title: h.text,
      words: wordCount(body),
      approx_tokens: approxTokens(body),
    });
  }
  return out.sort((a, b) => b.approx_tokens - a.approx_tokens);
}

function sumTokens(files: FileCost[]): number {
  return files.reduce((s, f) => s + f.approx_tokens, 0);
}

function sumWords(files: FileCost[]): number {
  return files.reduce((s, f) => s + f.words, 0);
}

function groupByTool(shared: FileCost[]): ToolGroup[] {
  const iso = shared.find((f) => ISO_SOURCE_RE.test(f.path));
  const claude = shared.find((f) => CLAUDE_FILE_RE.test(f.path));
  const agents = shared.find((f) => AGENTS_MD_RE.test(f.path));
  const opencodeInstr = shared.find((f) => OPENCODE_INSTR_RE.test(f.path));
  const modesShared = shared.find((f) => OPENCODE_SHARED_MODE_RE.test(f.path));
  const cursor = shared.filter((f) => CURSOR_RULE_RE.test(f.path));

  const groups: ToolGroup[] = [];

  // Claude Code — loads CLAUDE.md. Falls back to iso source if CLAUDE.md
  // isn't tracked (iso compiles to CLAUDE.md at build time).
  if (claude || iso) {
    const files = claude ? [claude] : [iso!];
    groups.push({
      id: "claude-code",
      name: "Claude Code (CLAUDE.md)",
      files,
      approx_tokens: sumTokens(files),
      words: sumWords(files),
      note: !claude && iso
        ? "CLAUDE.md not in repo; iso/instructions.md stands in as the compiled content."
        : undefined,
    });
  }

  // AGENTS.md convention — opencode / Codex CLI / Zed / etc. Loads
  // AGENTS.md + .opencode/instructions.md + modes/_shared.md (when those
  // exist). Falls back to iso source in place of AGENTS.md.
  const agentsBase = agents ?? iso;
  const ocFiles = [agentsBase, opencodeInstr, modesShared].filter(
    (x): x is FileCost => !!x,
  );
  if (ocFiles.length > 0) {
    groups.push({
      id: "agents-md",
      name: "AGENTS.md convention (opencode / Codex / Zed)",
      files: ocFiles,
      approx_tokens: sumTokens(ocFiles),
      words: sumWords(ocFiles),
      note: !agents && iso
        ? "AGENTS.md not in repo; iso/instructions.md stands in as the compiled content."
        : undefined,
    });
  }

  // Cursor — loads .cursor/rules/*.mdc. Frontmatter `alwaysApply` decides
  // which ones actually load every turn; we assume all and note the caveat.
  if (cursor.length > 0) {
    groups.push({
      id: "cursor",
      name: "Cursor (.cursor/rules)",
      files: cursor,
      approx_tokens: sumTokens(cursor),
      words: sumWords(cursor),
      note: "Total assumes alwaysApply: true on every .mdc. Frontmatter-aware counting not yet implemented.",
    });
  } else if (iso) {
    groups.push({
      id: "cursor",
      name: "Cursor (.cursor/rules)",
      files: [iso],
      approx_tokens: iso.approx_tokens,
      words: iso.words,
      note: ".cursor/rules/ not in repo; iso/instructions.md stands in as the compiled content.",
    });
  }

  return groups;
}

export function computeCost(
  files: DiscoveredFile[],
  opts: { sections?: boolean } = {},
): CostReport {
  const shared: FileCost[] = [];
  const modes: FileCost[] = [];
  const agents: FileCost[] = [];

  for (const f of files) {
    if (SHARED_PREFIX_PATH_RE.test(f.rel_path)) {
      shared.push(fileCost(f.rel_path, f.source, opts.sections ?? true));
    } else if (AGENT_PATH_RE.test(f.rel_path)) {
      agents.push(fileCost(f.rel_path, f.source, false));
    } else if (MODE_PATH_RE.test(f.rel_path)) {
      modes.push(fileCost(f.rel_path, f.source, false));
    }
  }

  shared.sort((a, b) => b.approx_tokens - a.approx_tokens);
  modes.sort((a, b) => b.approx_tokens - a.approx_tokens);
  agents.sort((a, b) => b.approx_tokens - a.approx_tokens);

  const tools = groupByTool(shared);

  let worstTool: ToolGroup | null = null;
  for (const t of tools) {
    if (!worstTool || t.approx_tokens > worstTool.approx_tokens) worstTool = t;
  }

  const worst_tool_tokens = worstTool?.approx_tokens ?? 0;
  const worst_tool_words = worstTool?.words ?? 0;

  return {
    tools,
    modes,
    agents,
    worst_tool_tokens,
    worst_tool_words,
    worst_tool: worstTool,
    heaviest_mode: modes[0] ?? null,
    heaviest_agent: agents[0] ?? null,
    shared_prefix: shared,
    shared_prefix_total_tokens: worst_tool_tokens,
    shared_prefix_total_words: worst_tool_words,
  };
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function formatSharedPrefixBreakdown(
  report: CostReport,
  withSections: boolean,
): string[] {
  const lines: string[] = [];
  lines.push("Shared-prefix files (section breakdown)");
  lines.push("");
  if (report.shared_prefix.length === 0) {
    lines.push("  (no shared-prefix files found)");
    return lines;
  }
  for (const f of report.shared_prefix) {
    lines.push(
      `  ${padLeft("~" + fmtInt(f.approx_tokens), 8)} tokens   ${pad(f.path, 38)}  ${padLeft(fmtInt(f.words), 6)} words`,
    );
    if (withSections && f.sections && f.sections.length > 0) {
      const cutoff = Math.max(200, Math.ceil(f.approx_tokens * 0.05));
      for (const s of f.sections) {
        if (s.approx_tokens < cutoff) break;
        lines.push(
          `    ${padLeft("~" + fmtInt(s.approx_tokens), 6)}   § ${pad(truncate(s.title, 60), 60)}  ${padLeft(fmtInt(s.words), 5)}w`,
        );
      }
    }
  }
  return lines;
}

function formatToolGroups(report: CostReport): string[] {
  const lines: string[] = [];
  lines.push("Per-tool always-loaded cost (pick the tool you actually run)");
  lines.push("");
  if (report.tools.length === 0) {
    lines.push("  (no shared-prefix files found — no tool-specific cost to report)");
    return lines;
  }
  for (const g of report.tools) {
    lines.push(
      `  ${pad(g.name, 48)}  ~${fmtInt(g.approx_tokens)} tokens / turn`,
    );
    for (const f of g.files) {
      lines.push(
        `    ${padLeft("~" + fmtInt(f.approx_tokens), 8)}   ${pad(f.path, 38)}  ${padLeft(fmtInt(f.words), 6)} words`,
      );
    }
    if (g.note) lines.push(`    note: ${g.note}`);
    lines.push("");
  }
  if (report.worst_tool) {
    lines.push(
      `  Worst-case tool: ${report.worst_tool.name} at ~${fmtInt(report.worst_tool_tokens)} tokens / turn`,
    );
  }
  return lines;
}

export function formatCost(report: CostReport, opts: { sections?: boolean } = {}): string {
  const lines: string[] = [];
  const withSections = opts.sections ?? true;

  lines.push(...formatSharedPrefixBreakdown(report, withSections));
  lines.push("");
  lines.push(...formatToolGroups(report));

  if (report.modes.length > 0) {
    lines.push("");
    lines.push("Per-mode context (loads when that mode runs)");
    lines.push("");
    for (const f of report.modes) {
      lines.push(
        `  ${padLeft("~" + fmtInt(f.approx_tokens), 8)} tokens   ${pad(f.path, 38)}  ${padLeft(fmtInt(f.words), 6)} words`,
      );
    }
    if (report.heaviest_mode && report.worst_tool) {
      const worstCaseTokens =
        report.worst_tool_tokens + report.heaviest_mode.approx_tokens;
      lines.push("");
      lines.push(
        `  Worst case (worst tool + heaviest mode): ~${fmtInt(worstCaseTokens)} tokens / turn`,
      );
    }
  }

  if (report.agents.length > 0) {
    lines.push("");
    lines.push("Per-agent context (loads on dispatch)");
    lines.push("");
    for (const f of report.agents) {
      lines.push(
        `  ${padLeft("~" + fmtInt(f.approx_tokens), 8)} tokens   ${pad(f.path, 38)}  ${padLeft(fmtInt(f.words), 6)} words`,
      );
    }
  }

  lines.push("");
  lines.push(
    "Token estimates are approximate (chars ÷ 4). Actual cost depends on the provider's tokenizer.",
  );

  return lines.join("\n");
}

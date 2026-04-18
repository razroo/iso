/**
 * Content-based dialect detection.
 *
 * Path classification (paths.ts) asks "where does this file live?" — dialect
 * detection asks "what shape is its content?". A file at AGENTS.md can be
 * plain harness prose or authored in a specific structured dialect that
 * wants different lint semantics.
 *
 * Currently recognised: agentmd (https://github.com/razroo/agentmd) — a
 * structured-markdown dialect for LLM agent prompts, with `# Agent: <name>`
 * H1, `## Hard limits` / `## Defaults` sections, and rule items shaped
 * `- [H1] claim` followed by an indented `why: rationale`. In that dialect
 * the rationale is load-bearing: the model uses it to judge edge cases.
 * Rules that normally flag rationale as overhead (e.g.
 * perf-rationale-in-shared-prefix) should skip agentmd files.
 */

import { getAst, headings } from "./ast.js";
import type { LintContext } from "./types.js";

/** True when the file uses the agentmd dialect (detected by its H1 header). */
export function isAgentmdFile(ctx: LintContext): boolean {
  const ast = getAst(ctx);
  for (const h of headings(ast)) {
    if (h.depth === 1 && /^Agent:\s+\S/.test(h.text)) return true;
  }
  return false;
}

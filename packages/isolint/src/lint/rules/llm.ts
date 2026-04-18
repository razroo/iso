/**
 * Tier 2 rules: LLM-assisted.
 *
 * The v0.1 implementation used Isomodel Plans (full schema-validated runtime
 * with retry/repair). Modern LLM APIs with JSON-mode return reliable
 * structured output directly, so each rule is now a single structured
 * prompt → parse → map-to-findings pipeline. Simpler, faster, still safe.
 *
 * These rules are opt-in via `--llm`. They cost tokens. Use them as a
 * secondary pass after the 28 deterministic rules.
 */

import type { CompletionResponse, ModelProvider } from "../../providers/types.js";
import type { LintContext, LintFinding, Rule, Severity } from "../types.js";
import { offsetToLineCol } from "../source.js";

interface LlmRuleSpec {
  id: string;
  severity: Severity;
  description: string;
  /** What the LLM is looking for, phrased for the system prompt. */
  objective: string;
  /** Specific guidance to avoid false positives. */
  guidance: string[];
  /** Optional few-shot examples shown to the model. */
  examples?: Array<{ snippet: string; why_bad: string }>;
}

interface LlmFindingRaw {
  line_start: unknown;
  line_end: unknown;
  snippet: unknown;
  message: unknown;
}

const SYSTEM_PROMPT = `You are a markdown harness reviewer. You scan prose meant to be executed by a weak 7B-class language model and flag phrases that would cause the model to fail — hallucinate content, drop clauses, or invent items.

Return ONLY a JSON object of the shape:
  {"findings": [{"line_start": N, "line_end": N, "snippet": "...", "message": "..."}]}

Rules:
- line_start and line_end are 1-based line numbers within the provided source.
- snippet is the exact phrase from the source, <= 200 characters.
- message is a concrete rewrite suggestion, <= 240 characters.
- Return {"findings": []} if nothing matches.
- DO NOT flag content inside fenced code blocks, inline code spans, HTML comments, or YAML frontmatter.
- DO NOT flag headings unless the heading itself is the violation.`;

function buildUserPrompt(ctx: LintContext, spec: LlmRuleSpec): string {
  const parts: string[] = [
    `RULE: ${spec.id}`,
    `OBJECTIVE: ${spec.objective}`,
    ``,
    `GUIDANCE (avoid false positives):`,
    ...spec.guidance.map((g) => `  - ${g}`),
  ];
  if (spec.examples && spec.examples.length > 0) {
    parts.push(``, `EXAMPLES OF WHAT TO FLAG:`);
    for (const ex of spec.examples) {
      parts.push(`  snippet: ${JSON.stringify(ex.snippet)}`);
      parts.push(`  why:     ${ex.why_bad}`);
    }
  }
  parts.push(``, `FILE: ${ctx.file}`, ``, `SOURCE (numbered lines):`);
  const lines = ctx.source.split("\n");
  const width = String(lines.length).length;
  for (let i = 0; i < lines.length; i++) {
    const num = String(i + 1).padStart(width, " ");
    parts.push(`${num} | ${lines[i]}`);
  }
  parts.push(``, `Return ONLY a JSON object of the shape described in the system prompt.`);
  return parts.join("\n");
}

function parseFindings(res: CompletionResponse): LlmFindingRaw[] {
  const content = res.content.trim();
  // Strip ```json fences if the model wrapped its output.
  const stripped = content.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed.findings)) return parsed.findings as LlmFindingRaw[];
    return [];
  } catch {
    return [];
  }
}

function clamp(n: unknown, lo: number, hi: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

async function runLlmRule(
  ctx: LintContext,
  model: ModelProvider,
  spec: LlmRuleSpec,
): Promise<LintFinding[]> {
  const prompt = buildUserPrompt(ctx, spec);
  let res: CompletionResponse;
  try {
    res = await model.complete({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      json_mode: true,
    });
  } catch {
    return [];
  }

  const raw = parseFindings(res);
  const lines = ctx.source.split("\n");
  const findings: LintFinding[] = [];

  for (const r of raw) {
    const lineStart = clamp(r.line_start, 1, lines.length);
    const lineEnd = clamp(r.line_end, lineStart, lines.length);
    const offsetStart = ctx.line_starts[lineStart - 1] ?? 0;
    const offsetEnd = (ctx.line_starts[lineEnd] ?? ctx.source.length) - 1;
    const start = offsetToLineCol(ctx, offsetStart);
    const end = offsetToLineCol(ctx, offsetEnd);
    const rawSnippet = typeof r.snippet === "string" ? r.snippet : "";
    const snippet = rawSnippet.trim()
      ? rawSnippet.slice(0, 200)
      : lines.slice(lineStart - 1, lineEnd).join("\n").slice(0, 200);
    const rawMessage = typeof r.message === "string" ? r.message : "small-model-hostile phrasing";

    findings.push({
      rule_id: spec.id,
      severity: spec.severity,
      file: ctx.file,
      range: {
        line: start.line,
        column: start.column,
        end_line: end.line,
        end_column: end.column,
      },
      message: rawMessage.slice(0, 240),
      snippet,
      llm_fixable: true,
    });
  }
  return findings;
}

/** ---- Specs --------------------------------------------------------- */

const atomicity: LlmRuleSpec = {
  id: "llm-atomicity",
  severity: "warn",
  description: "Instructions that bundle multiple atomic actions into one step.",
  objective: "Find instructions that ask the reader to do more than one atomic action in a single sentence or bullet.",
  guidance: [
    "Only flag true non-atomic instructions (e.g., 'extract X, save Y, AND update Z').",
    "Do not flag compound subjects or simple clauses ('extract title and company').",
    "Do not flag prose documentation — only instructions the model must execute.",
  ],
  examples: [
    { snippet: "Extract all fields, validate them, and save to the tracker.", why_bad: "Three atomic actions in one bullet — weak models skip one." },
  ],
};

const implicitContext: LlmRuleSpec = {
  id: "llm-implicit-context",
  severity: "warn",
  description: "Phrases that rely on context not present in the file.",
  objective: "Find phrases that assume the reader knows a convention, format, or rule that isn't stated in this file.",
  guidance: [
    "Flag 'the usual format', 'standard convention', 'normal flow', 'default behavior' when the specifics aren't given.",
    "Do NOT flag explicit cross-file references to named files (e.g., `_shared.md`) or named sections.",
    "Do NOT flag widely-known programming concepts (JSON, HTTP, SQL syntax).",
  ],
  examples: [
    { snippet: "Follow the usual format for the report.", why_bad: "What format? Weak models guess." },
  ],
};

const unexplainedSchema: LlmRuleSpec = {
  id: "llm-unexplained-schema",
  severity: "warn",
  description: "Output contracts described in prose with no example / schema nearby.",
  objective: "Find places where a step tells the reader to return structured output (JSON, YAML, a table) but only describes it in prose without an inline example or schema.",
  guidance: [
    "Only flag when no concrete example or schema is visible within 10 lines of the instruction.",
    "Fenced code blocks, bullet lists of fields, or inline object examples all satisfy the requirement.",
    "Do not flag plain prose outputs ('return a summary sentence').",
  ],
  examples: [
    { snippet: "Return JSON with the candidate's score and reason.", why_bad: "No example or field list — weak models invent the shape." },
  ],
};

const toneDrift: LlmRuleSpec = {
  id: "llm-tone-drift",
  severity: "info",
  description: "Tone shifts within a harness — authoritative steps followed by conversational prose.",
  objective: "Find places where the harness slips from authoritative imperatives ('MUST', 'ALWAYS') into casual / conversational phrasing ('maybe', 'you can', 'feel free') within the same logical section.",
  guidance: [
    "Only flag when the SAME section or step mixes tones — not across different file sections.",
    "Weak models follow commanding prose more reliably. Tone drift signals ambiguity about whether a rule is mandatory.",
    "Do not flag adjacent question-and-answer pairs (one is a query, one is a directive).",
  ],
  examples: [
    { snippet: "You MUST validate input. Feel free to skip if it looks fine.", why_bad: "MUST + 'feel free to skip' → weak models pick the easier path." },
  ],
};

const implicitAssumption: LlmRuleSpec = {
  id: "llm-implicit-assumption",
  severity: "warn",
  description: "Sentences that assume facts not established elsewhere in the harness.",
  objective: "Find individual sentences that reference or assume entities, values, or behaviors that have no prior definition in the file.",
  guidance: [
    "Stricter and more granular than llm-implicit-context — focus on specific concrete references.",
    "Flag 'the candidate's preferred flow', 'the standard cutoff', 'the typical score' when those concepts have no earlier definition.",
    "Do not flag universal domain terms (ISO 8601, UTC, JSON, HTTP status).",
    "Do not flag references satisfied by a visible YAML/JSON schema block.",
  ],
};

/** ---- Rules --------------------------------------------------------- */

export const llmAtomicity: Rule = {
  id: atomicity.id,
  tier: "llm",
  severity: atomicity.severity,
  description: atomicity.description,
  async checkLLM(ctx, model) { return runLlmRule(ctx, model, atomicity); },
};

export const llmImplicitContext: Rule = {
  id: implicitContext.id,
  tier: "llm",
  severity: implicitContext.severity,
  description: implicitContext.description,
  async checkLLM(ctx, model) { return runLlmRule(ctx, model, implicitContext); },
};

export const llmUnexplainedSchema: Rule = {
  id: unexplainedSchema.id,
  tier: "llm",
  severity: unexplainedSchema.severity,
  description: unexplainedSchema.description,
  async checkLLM(ctx, model) { return runLlmRule(ctx, model, unexplainedSchema); },
};

export const llmToneDrift: Rule = {
  id: toneDrift.id,
  tier: "llm",
  severity: toneDrift.severity,
  description: toneDrift.description,
  async checkLLM(ctx, model) { return runLlmRule(ctx, model, toneDrift); },
};

export const llmImplicitAssumption: Rule = {
  id: implicitAssumption.id,
  tier: "llm",
  severity: implicitAssumption.severity,
  description: implicitAssumption.description,
  async checkLLM(ctx, model) { return runLlmRule(ctx, model, implicitAssumption); },
};

export const LLM_RULES: Rule[] = [
  llmAtomicity,
  llmImplicitContext,
  llmUnexplainedSchema,
  llmToneDrift,
  llmImplicitAssumption,
];

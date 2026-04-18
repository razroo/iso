import { collectCodeBlocks, collectHeadings, collectListBlocks, getAst, isInsideTable, paragraphs } from "../ast.js";
import { isAgentmdFile } from "../dialect.js";
import { HARNESS_PATH_RE, SHARED_PREFIX_PATH_RE } from "../paths.js";
import { tokenizeSentences, type Sentence } from "../sentences.js";
import { computeSkipIntervals, rangeFromOffsets } from "../source.js";
import type { Fix, LintContext, LintFinding, Rule } from "../types.js";
const EXAMPLE_TITLE_RE = /\b(example|examples|sample|samples)\b/i;
const STEP_TITLE_RE = /^step\b/i;
const OUTPUT_VERB_RE = /\b(return|respond(?:\s+with)?|emit|output|provide)\b/i;
const STRUCTURED_OUTPUT_RE = /\b(json|yaml|yml|csv|table|object|array|list|xml)\b/i;
const ACTION_CUE_RE = /\b(return|emit|output|extract|classify|score|rank|validate|read|write|save|select|choose|set|check|parse|map|filter|compare|summarize|format|call|use|include|exclude)\b/gi;
const STRUCTURE_CUE_RE = /(\$input|\$steps\.|```|`[^`\n]+`|\bjson\b|\byaml\b|\bregex\b|\bschema\b|\bexactly\b|\bat most\b|\bat least\b|\bmust\b|\bnever\b|\b\d+\b|^\s*[-*]\s+)/gim;
const STYLE_TONE_RE = /\b(friendly|professional|warm|conversational|human(?:-sounding)?|natural|polite|empathetic|enthusiastic|persuasive|confident|approachable|on-brand|brand voice|tone|voice|style)\b/i;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "if",
  "in", "into", "is", "it", "of", "on", "or", "that", "the", "their",
  "then", "there", "these", "this", "to", "use", "with", "your",
]);

interface SectionInfo {
  title: string;
  start_offset: number;
  content_start: number;
  end_offset: number;
}

interface ParagraphInfo {
  text: string;
  start: number;
  end: number;
  section: SectionInfo;
}

function inHarnessPath(ctx: LintContext): boolean {
  return HARNESS_PATH_RE.test(ctx.file);
}

function inSharedPrefixPath(ctx: LintContext): boolean {
  return SHARED_PREFIX_PATH_RE.test(ctx.file);
}

function sentenceSkips(ctx: LintContext): [number, number][] {
  return computeSkipIntervals(ctx.source, {
    ...ctx.config.skip_spans,
    inline_code: false,
    quoted_strings: false,
  });
}

function findingAt(
  ctx: LintContext,
  rule: { id: string; severity: "error" | "warn" | "info" },
  start: number,
  end: number,
  message: string,
  snippet?: string,
  opts: { severity?: "error" | "warn" | "info"; fix?: Fix; llm_fixable?: boolean } = {},
): LintFinding {
  return {
    rule_id: rule.id,
    severity: opts.severity ?? rule.severity,
    file: ctx.file,
    range: rangeFromOffsets(ctx, start, Math.max(end, start + 1)),
    message,
    snippet: snippet ?? ctx.source.slice(start, end),
    ...(opts.fix ? { fix: opts.fix } : {}),
    ...(opts.llm_fixable ? { llm_fixable: true } : {}),
  };
}

function collectSections(ctx: LintContext): SectionInfo[] {
  const headings = collectHeadings(getAst(ctx));
  if (headings.length === 0) {
    return [{
      title: "(file)",
      start_offset: 0,
      content_start: 0,
      end_offset: ctx.source.length,
    }];
  }
  return headings.map((heading, index) => ({
    title: heading.text,
    start_offset: heading.start_offset,
    content_start: heading.end_offset,
    end_offset: headings[index + 1]?.start_offset ?? ctx.source.length,
  }));
}

function sectionAt(sections: SectionInfo[], offset: number): SectionInfo {
  let best = sections[0];
  for (const section of sections) {
    if (section.start_offset <= offset) best = section;
    else break;
  }
  return best;
}

function collectParagraphsBySection(ctx: LintContext, sections: SectionInfo[]): ParagraphInfo[] {
  const out: ParagraphInfo[] = [];
  for (const paragraph of paragraphs(getAst(ctx))) {
    const text = collapseWhitespace(paragraph.text);
    if (!text) continue;
    const section = sectionAt(sections, paragraph.start);
    out.push({ text, start: paragraph.start, end: paragraph.end, section });
  }
  return out;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.match(/[A-Za-z0-9$_.-]+/g)?.length ?? 0;
}

function normalizeExact(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$steps\.[a-z0-9_-]+/g, "$steps")
    .replace(/\$input(?:\.[a-z0-9_.-]+)?/g, "$input")
    .replace(/\bstep\s+\d+\b/g, "step")
    .replace(/\bblock\s+[a-z0-9]+\b/g, "block")
    .replace(/[^a-z0-9$_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticTokens(text: string): string[] {
  return normalizeExact(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap++;
  }
  return overlap / (setA.size + setB.size - overlap);
}

function looksInstructional(text: string): boolean {
  return /\b(return|emit|output|extract|classify|score|rank|validate|read|write|save|select|choose|set|check|parse|map|filter|compare|summarize|format|call|include|exclude|must|always|never)\b/i.test(text);
}

function sectionLabel(section: SectionInfo): string {
  return section.title === "(file)" ? "earlier in the file" : `"${section.title}"`;
}

function truncate(text: string, max = 200): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function countMatches(text: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let count = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

function firstSentence(text: string): string {
  const sentences = tokenizeSentences(text);
  return collapseWhitespace(sentences[0]?.text ?? text);
}

function lineBounds(source: string, offset: number): { start: number; end: number } {
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextBreak = source.indexOf("\n", offset);
  const end = nextBreak === -1 ? source.length : nextBreak;
  return { start, end };
}

function lineTextAt(source: string, offset: number): string {
  const { start, end } = lineBounds(source, offset);
  return source.slice(start, end);
}

function startsOnHeadingLine(ctx: LintContext, offset: number): boolean {
  return /^\s{0,3}#{1,6}\s/.test(lineTextAt(ctx.source, offset));
}

function startsOnTableLine(ctx: LintContext, offset: number): boolean {
  return /^\s*\|/.test(lineTextAt(ctx.source, offset));
}

function inTableOrHeading(ctx: LintContext, offset: number): boolean {
  return startsOnHeadingLine(ctx, offset) || startsOnTableLine(ctx, offset) || isInsideTable(getAst(ctx), offset);
}

function nextNonEmptyLineAfter(source: string, offset: number): string {
  const { end } = lineBounds(source, offset);
  const rest = source.slice(Math.min(source.length, end + 1)).split("\n");
  for (const line of rest) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function isExampleIntroSentence(ctx: LintContext, offset: number, text: string): boolean {
  if (text.includes("|")) return true;
  const line = lineTextAt(ctx.source, offset).trim();
  if (!line.endsWith(":")) return false;
  if (!/\b(example|shape|schema|json)\b/i.test(text)) return false;
  const next = nextNonEmptyLineAfter(ctx.source, offset);
  return /^```(?:json|yaml|yml)?\b/i.test(next);
}

function hasNearbyStructuredContract(lines: string[], startLine: number, endLine: number): boolean {
  const lo = Math.max(0, startLine - 9);
  const hi = Math.min(lines.length - 1, endLine + 7);
  let fieldLines = 0;

  for (let i = lo; i <= hi; i++) {
    const line = lines[i].trim();
    if (/^```(?:json|yaml|yml)\b/i.test(line)) return true;
    if (/\b(json schema|schema:|properties:|required:|additionalProperties)\b/i.test(line)) return true;
    if (
      /^[-*]\s+/.test(line)
      && (
        /^[-*]\s+`[^`]+`\s*:/.test(line)
        || /^[-*]\s+[A-Za-z0-9_.-]+\s*:/.test(line)
        || /\b(field|fields|key|keys|property|properties)\b/i.test(line)
      )
    ) {
      fieldLines++;
    }
  }

  return fieldLines >= 2;
}

function looksLikeSchemaRestatement(text: string): boolean {
  return /\b(fields?|keys?|properties|json object|json array|shape)\b/i.test(text);
}

function stripFrontmatter(source: string): string {
  return source
    .replace(/^\+\+\+\n[\s\S]*?\n\+\+\+\n?/, "")
    .replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function sharedPrefixMetrics(source: string): { words: number; approx_tokens: number } {
  const body = stripFrontmatter(source);
  const words = wordCount(body);
  return { words, approx_tokens: Math.ceil(body.length / 4) };
}

function previousNonEmptyLineBefore(source: string, offset: number): string {
  const before = source.slice(0, Math.max(0, offset)).split("\n");
  for (let i = before.length - 1; i >= 0; i--) {
    const trimmed = before[i].trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function codeBlockLooksLikeSharedExample(ctx: LintContext, language: string, offset: number, section: SectionInfo): boolean {
  if (/^(json|yaml|yml)$/i.test(language)) return true;
  const previous = previousNonEmptyLineBefore(ctx.source, offset);
  return EXAMPLE_TITLE_RE.test(section.title) || /\b(example|sample|schema|shape|output)\b/i.test(previous);
}

function mirroredAgentCounterpart(file: string): string | undefined {
  if (file.startsWith("iso/agents/")) return `.opencode/agents/${file.slice("iso/agents/".length)}`;
  if (file.startsWith(".opencode/agents/")) return `iso/agents/${file.slice(".opencode/agents/".length)}`;
  return undefined;
}

function mirroredSimilarity(a: string, b: string): number {
  const normA = normalizeExact(stripFrontmatter(a));
  const normB = normalizeExact(stripFrontmatter(b));
  if (!normA || !normB) return 0;
  return Math.max(
    normA === normB ? 1 : 0,
    normA.includes(normB) || normB.includes(normA) ? 0.95 : 0,
    jaccard(semanticTokens(normA), semanticTokens(normB)),
  );
}

function buildTrailingToneFix(start: number, end: number, text: string): Fix | undefined {
  const match = /^(.*?)(?:,\s*)?\s+(?:in|with|using)\s+(?:a|an)?\s*([a-z][a-z\s,-]{0,80})\s+(tone|style)\s*([.?!])$/i.exec(text.trim());
  if (!match) return undefined;
  const prefix = match[1].trim().replace(/[,\s]+$/g, "");
  if (!prefix || /\b(and|or|but)$/i.test(prefix)) return undefined;
  const replacement = `${prefix}${match[4]}`;
  if (replacement === text) return undefined;
  return {
    start,
    end,
    replacement,
    description: "Remove trailing tone/style phrasing from a structured-output instruction.",
  };
}

/** ---- Rule: repeated instruction blocks ------------------------------- */

export const perfRepeatedInstructionBlock: Rule = {
  id: "perf-repeated-instruction-block",
  tier: "deterministic",
  severity: "info",
  description: "Repeated instruction paragraphs across sections waste context and tokens.",
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sections = collectSections(ctx);
    const blocks = collectParagraphsBySection(ctx, sections)
      .filter((paragraph) => !EXAMPLE_TITLE_RE.test(paragraph.section.title))
      .filter((paragraph) => !STEP_TITLE_RE.test(paragraph.section.title))
      .filter((paragraph) => wordCount(paragraph.text) >= 8)
      .filter((paragraph) => looksInstructional(paragraph.text));

    const firstByKey = new Map<string, ParagraphInfo>();
    const findings: LintFinding[] = [];

    for (const block of blocks) {
      const key = normalizeExact(block.text);
      if (!key) continue;
      const earlier = firstByKey.get(key);
      if (!earlier) {
        firstByKey.set(key, block);
        continue;
      }
      if (earlier.section.title === block.section.title) continue;
      findings.push(
        findingAt(
          ctx,
          perfRepeatedInstructionBlock,
          block.start,
          block.end,
          `This instruction block repeats guidance already present in ${sectionLabel(earlier.section)}. Reuse one shared block instead of duplicating it.`,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: example-heavy section ------------------------------------ */

export const perfExampleHeavySection: Rule = {
  id: "perf-example-heavy-section",
  tier: "deterministic",
  severity: "info",
  description: "Examples that outweigh the task definition consume context without improving execution.",
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sections = collectSections(ctx);
    const exampleSections = sections.filter((section) => EXAMPLE_TITLE_RE.test(section.title));
    if (exampleSections.length === 0) return [];

    const nonExampleWords = sections
      .filter((section) => !EXAMPLE_TITLE_RE.test(section.title))
      .reduce((sum, section) => sum + wordCount(ctx.source.slice(section.content_start, section.end_offset)), 0);

    const findings: LintFinding[] = [];
    for (const section of exampleSections) {
      const words = wordCount(ctx.source.slice(section.content_start, section.end_offset));
      if (words < 120) continue;
      if (nonExampleWords > 0 && words <= nonExampleWords * 1.25) continue;
      findings.push(
        findingAt(
          ctx,
          perfExampleHeavySection,
          section.start_offset,
          section.content_start,
          `Section "${section.title}" is ${words} words, which outweighs the task-defining instructions (${nonExampleWords} words). Trim or externalize the example.`,
          section.title,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: duplicated output requirements --------------------------- */

export const perfDuplicatedOutputRequirement: Rule = {
  id: "perf-duplicated-output-requirement",
  tier: "deterministic",
  severity: "info",
  description: "Repeated output contracts add tokens without changing behavior.",
  examples: [
    {
      bad: "Return JSON with fields score and reason. Use the same JSON format as above.",
      good: "Return the result using the existing JSON format.",
      why: "Avoid restating the wire format when the contract already exists nearby.",
    },
  ],
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sections = collectSections(ctx);
    const sentences = tokenizeSentences(ctx.source, sentenceSkips(ctx));
    const firstByKey = new Map<string, { sentence: Sentence; section: SectionInfo }>();
    const findings: LintFinding[] = [];

    for (const sentence of sentences) {
      const text = collapseWhitespace(sentence.text);
      if (wordCount(text) < 5) continue;
      if (!OUTPUT_VERB_RE.test(text) || !STRUCTURED_OUTPUT_RE.test(text)) continue;

      const key = normalizeExact(text);
      const section = sectionAt(sections, sentence.start);
      const earlier = firstByKey.get(key);
      if (!earlier) {
        firstByKey.set(key, { sentence, section });
        continue;
      }

      findings.push(
        findingAt(
          ctx,
          perfDuplicatedOutputRequirement,
          sentence.start,
          sentence.end,
          `This output requirement duplicates guidance already stated in ${sectionLabel(earlier.section)}. Keep one contract source and point later steps at it.`,
          undefined,
          { llm_fixable: true },
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: step restates prior step -------------------------------- */

export const perfStepRestatesPriorStep: Rule = {
  id: "perf-step-restates-prior-step",
  tier: "deterministic",
  severity: "warn",
  description: "A later step that mostly repeats an earlier step adds latency without new work.",
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sections = collectSections(ctx).filter((section) => STEP_TITLE_RE.test(section.title));
    if (sections.length < 2) return [];

    const stepBodies = sections
      .map((section) => ({
        section,
        text: collapseWhitespace(ctx.source.slice(section.content_start, section.end_offset)),
      }))
      .filter((entry) => wordCount(entry.text) >= 10)
      .map((entry) => ({ ...entry, tokens: semanticTokens(entry.text) }));

    const findings: LintFinding[] = [];
    for (let i = 1; i < stepBodies.length; i++) {
      const current = stepBodies[i];
      const currentNorm = normalizeExact(current.text);
      let best: { section: SectionInfo; score: number } | null = null;

      for (let j = 0; j < i; j++) {
        const earlier = stepBodies[j];
        const earlierNorm = normalizeExact(earlier.text);
        const score = Math.max(
          currentNorm === earlierNorm ? 1 : 0,
          currentNorm.includes(earlierNorm) || earlierNorm.includes(currentNorm) ? 0.9 : 0,
          jaccard(current.tokens, earlier.tokens),
        );
        if (!best || score > best.score) best = { section: earlier.section, score };
      }

      if (!best || best.score < 0.8) continue;

      findings.push(
        findingAt(
          ctx,
          perfStepRestatesPriorStep,
          current.section.start_offset,
          current.section.content_start,
          `${sectionLabel(current.section)} mostly restates ${sectionLabel(best.section)}. Merge the steps or make the later step do distinct work.`,
          truncate(firstSentence(current.text)),
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: low-value prose section --------------------------------- */

export const perfLowValueProseSection: Rule = {
  id: "perf-low-value-prose-section",
  tier: "deterministic",
  severity: "info",
  description: "Large narrative sections with few operational cues waste prompt budget.",
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sections = collectSections(ctx);
    const findings: LintFinding[] = [];

    for (const section of sections) {
      if (EXAMPLE_TITLE_RE.test(section.title)) continue;
      const body = ctx.source.slice(section.content_start, section.end_offset);
      const words = wordCount(body);
      if (words < 120) continue;

      const cues = countMatches(body, ACTION_CUE_RE) + countMatches(body, STRUCTURE_CUE_RE);
      if (cues >= Math.ceil(words / 60)) continue;

      findings.push(
        findingAt(
          ctx,
          perfLowValueProseSection,
          section.start_offset,
          section.content_start,
          `Section "${section.title}" is ${words} words but has only ${cues} operational cue${cues === 1 ? "" : "s"}. Trim narrative guidance or move it out of the runtime harness.`,
          section.title,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: shared-prefix budget ------------------------------------ */

export const perfSharedPrefixBudget: Rule = {
  id: "perf-shared-prefix-budget",
  tier: "deterministic",
  severity: "info",
  description: "Large always-loaded harness files burn prompt budget even when every paragraph is operational.",
  check(ctx) {
    if (!inSharedPrefixPath(ctx)) return [];

    const { words, approx_tokens } = sharedPrefixMetrics(ctx.source);
    if (words < 1500) return [];

    return [
      findingAt(
        ctx,
        perfSharedPrefixBudget,
        0,
        Math.max(1, lineBounds(ctx.source, 0).end),
        `Shared-prefix file is ${words} words (~${approx_tokens} prompt tokens). Split stable core from on-demand reference files to preserve cache efficiency.`,
        ctx.file,
      ),
    ];
  },
};

/** ---- Rule: large example block in shared prefix -------------------- */

export const perfLargeExampleInSharedPrefix: Rule = {
  id: "perf-large-example-in-shared-prefix",
  tier: "deterministic",
  severity: "info",
  description: "Large structured examples in always-loaded files should move to on-demand references.",
  check(ctx) {
    if (!inSharedPrefixPath(ctx)) return [];

    const sections = collectSections(ctx);
    const findings: LintFinding[] = [];
    for (const block of collectCodeBlocks(getAst(ctx))) {
      const words = wordCount(block.value);
      const section = sectionAt(sections, block.start_offset);
      if (words < 80 && block.value.length < 600) continue;
      if (!codeBlockLooksLikeSharedExample(ctx, block.language, block.start_offset, section)) continue;

      findings.push(
        findingAt(
          ctx,
          perfLargeExampleInSharedPrefix,
          block.start_offset,
          block.end_offset,
          `Shared-prefix file embeds a large ${block.language || "structured"} example block (${words} words). Move it to an on-demand reference and keep only a short pointer here.`,
          section.title === "(file)" ? lineTextAt(ctx.source, block.start_offset).trim() : section.title,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: long runbook in shared prefix --------------------------- */

export const perfLongRunbookInSharedPrefix: Rule = {
  id: "perf-long-runbook-in-shared-prefix",
  tier: "deterministic",
  severity: "info",
  description: "Detailed numbered runbooks are cheaper in mode-specific files than in global shared prefixes.",
  check(ctx) {
    if (!inSharedPrefixPath(ctx)) return [];

    const sections = collectSections(ctx);
    const findings: LintFinding[] = [];
    for (const list of collectListBlocks(getAst(ctx))) {
      if (!list.ordered || list.items.length < 4) continue;
      const totalWords = list.items.reduce((sum, item) => sum + wordCount(item.text), 0);
      if (totalWords < 110) continue;

      const section = sectionAt(sections, list.start_offset);
      findings.push(
        findingAt(
          ctx,
          perfLongRunbookInSharedPrefix,
          list.start_offset,
          list.end_offset,
          `Shared-prefix file contains a long ${list.items.length}-step runbook (${totalWords} words). Move the detailed runbook to a mode-specific file and keep a short pointer here.`,
          section.title === "(file)" ? truncate(list.items[0]?.text ?? "") : section.title,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: redundant schema prose ---------------------------------- */

export const perfRedundantSchemaProse: Rule = {
  id: "perf-redundant-schema-prose",
  tier: "deterministic",
  severity: "info",
  description: "When a nearby schema or example already defines the contract, prose restating it is redundant.",
  examples: [
    {
      bad: "Return JSON with fields title, owner, and score.",
      good: "Return the result using the schema below.",
      why: "If a nearby schema or field list already defines the structure, keep the prose focused on the task.",
    },
  ],
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const lines = ctx.source.split("\n");
    const sentences = tokenizeSentences(ctx.source, sentenceSkips(ctx));
    const findings: LintFinding[] = [];

    for (const sentence of sentences) {
      const text = collapseWhitespace(sentence.text);
      if (inTableOrHeading(ctx, sentence.start)) continue;
      if (isExampleIntroSentence(ctx, sentence.start, text)) continue;
      if (!OUTPUT_VERB_RE.test(text)) continue;
      if (!looksLikeSchemaRestatement(text)) continue;

      const range = rangeFromOffsets(ctx, sentence.start, sentence.end);
      if (!hasNearbyStructuredContract(lines, range.line - 1, (range.end_line ?? range.line) - 1)) continue;

      findings.push(
        findingAt(
          ctx,
          perfRedundantSchemaProse,
          sentence.start,
          sentence.end,
          "This prose repeats a nearby schema, field list, or structured example. Keep one contract source instead of duplicating it.",
          undefined,
          { llm_fixable: true },
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: mirrored agent spec ------------------------------------- */

export const perfMirroredAgentSpec: Rule = {
  id: "perf-mirrored-agent-spec",
  tier: "deterministic",
  severity: "info",
  description: "Near-duplicate agent specs across adapter directories are a maintenance and prompt-budget smell.",
  check(ctx) {
    const counterpart = mirroredAgentCounterpart(ctx.file);
    if (!counterpart || !ctx.repo_sources?.has(counterpart)) return [];
    if (ctx.file.localeCompare(counterpart) < 0) return [];

    const other = ctx.repo_sources.get(counterpart) ?? "";
    const ownBody = stripFrontmatter(ctx.source);
    const otherBody = stripFrontmatter(other);
    if (Math.min(wordCount(ownBody), wordCount(otherBody)) < 80) return [];

    const similarity = mirroredSimilarity(ctx.source, other);
    if (similarity < 0.88) return [];

    return [
      findingAt(
        ctx,
        perfMirroredAgentSpec,
        0,
        Math.max(1, lineBounds(ctx.source, 0).end),
        `This agent spec largely mirrors "${counterpart}". Consolidate the shared instructions or generate one adapter from the other.`,
        counterpart,
      ),
    ];
  },
};

/** ---- Rule: structured output + explanation -------------------------- */

export const perfStructuredOutputExplanation: Rule = {
  id: "perf-structured-output-explanation",
  tier: "deterministic",
  severity: "warn",
  description: "Requiring free-form explanation alongside structured output adds tokens and latency.",
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sentences = tokenizeSentences(ctx.source, sentenceSkips(ctx));
    const findings: LintFinding[] = [];

    for (const sentence of sentences) {
      const text = collapseWhitespace(sentence.text);
      if (inTableOrHeading(ctx, sentence.start)) continue;
      if (!STRUCTURED_OUTPUT_RE.test(text)) continue;
      if (!/\b(and|plus|along with|together with)\b/i.test(text)) continue;
      if (!/\b(explain|explanation|justify|justification|describe why|include (?:a )?(?:short )?(?:explanation|rationale|analysis)|add (?:a )?(?:short )?(?:explanation|rationale|analysis)|show (?:your )?reasoning)\b/i.test(text)) continue;
      if (/\b(field|key|property)\b/i.test(text)) continue;

      findings.push(
        findingAt(
          ctx,
          perfStructuredOutputExplanation,
          sentence.start,
          sentence.end,
          "This step asks for structured output plus a separate explanation. Drop the explanation or encode it as a field if the consumer truly needs it.",
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: style / tone overhead ----------------------------------- */

export const perfStyleToneOverhead: Rule = {
  id: "perf-style-tone-overhead",
  tier: "deterministic",
  severity: "info",
  description: "Tone instructions on structured outputs add context without changing the contract.",
  examples: [
    {
      bad: "Return JSON in a friendly, conversational tone.",
      good: "Return JSON.",
      why: "Tone guidance does not change a structured contract and wastes prompt budget.",
    },
  ],
  check(ctx) {
    if (!inHarnessPath(ctx)) return [];

    const sentences = tokenizeSentences(ctx.source, sentenceSkips(ctx));
    const findings: LintFinding[] = [];

    for (const sentence of sentences) {
      const text = collapseWhitespace(sentence.text);
      if (inTableOrHeading(ctx, sentence.start)) continue;
      if (text.includes("|")) continue;
      if (!OUTPUT_VERB_RE.test(text)) continue;
      if (!STRUCTURED_OUTPUT_RE.test(text)) continue;
      if (!STYLE_TONE_RE.test(text)) continue;

      findings.push(
        findingAt(
          ctx,
          perfStyleToneOverhead,
          sentence.start,
          sentence.end,
          "Tone or style guidance on a structured output usually adds tokens without changing execution. Keep it only if a user reads the prose directly.",
          undefined,
          {
            llm_fixable: true,
            fix: buildTrailingToneFix(sentence.start, sentence.end, sentence.text),
          },
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: rationale / history in shared prefix -------------------- */

const RATIONALE_START_RE = /^(?:\*+\s*)?(?:why|context|background|rationale|historical\s+(?:note|context)|the\s+reason|previously|in\s+the\s+past|note\s+to\s+future|post[-\s]?mortem|note)(?:\*+)?\s*[:—–-]/i;
const INCIDENT_DATE_RE = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/;
const INCIDENT_CUE_RE = /\b(incident|post[-\s]?mortem|outage|regression|hallucinat(?:e|ed|ion)|broke|failed|lost|invented|fabricated|404ed?|downtime|bug(?:\s+was)?|went\s+(?:down|wrong))\b/i;

export const perfRationaleInSharedPrefix: Rule = {
  id: "perf-rationale-in-shared-prefix",
  tier: "deterministic",
  severity: "info",
  description: "Rationale and post-mortem narratives in always-loaded files burn tokens every turn. Keep the rule; move the story.",
  examples: [
    {
      bad: "Why: on 2026-04-18, a scan subagent fabricated 30 IDs that all 404'd, so now we require authoritative files.",
      good: "Load-bearing facts passed to downstream subagents must come from an authoritative file, not prior subagent prose.",
      why: "The runtime rule should be crisp; incident narrative belongs in a post-mortem doc.",
      path: "AGENTS.md",
    },
  ],
  check(ctx) {
    if (!inSharedPrefixPath(ctx)) return [];
    // agentmd dialect treats rationale as load-bearing (the model uses it to
    // judge edge cases). Skip — see src/lint/dialect.ts.
    if (isAgentmdFile(ctx)) return [];

    const findings: LintFinding[] = [];
    for (const paragraph of paragraphs(getAst(ctx))) {
      const text = collapseWhitespace(paragraph.text);
      if (wordCount(text) < 30) continue;

      let reason = "";
      if (RATIONALE_START_RE.test(text)) {
        reason = "opens with a rationale/history cue";
      } else if (INCIDENT_DATE_RE.test(text) && INCIDENT_CUE_RE.test(text)) {
        reason = "contains a dated incident narrative";
      } else {
        continue;
      }

      findings.push(
        findingAt(
          ctx,
          perfRationaleInSharedPrefix,
          paragraph.start,
          paragraph.end,
          `This paragraph ${reason}. Rationale in a shared-prefix file costs tokens every turn — move it to a post-mortem or commit message and keep the runtime rule short.`,
          truncate(firstSentence(text)),
        ),
      );
    }
    return findings;
  },
};

/** ---- Rule: emphasis inflation -------------------------------------- */

// All-caps intensifiers only: "MUST" signals emphasis, lowercase "must" is
// ordinary prose. Bullet-style "DO NOT" / "MUST NOT" are counted explicitly.
const INTENSIFIER_RE = /\b(?:MUST(?:\s+NOT)?|ALWAYS|NEVER(?:\s+EVER)?|CRITICAL|MANDATORY|REQUIRED|NON[-\s]?NEGOTIABLE|HARD\s+RULE|ABSOLUTELY|STRICTLY|ESSENTIAL|IMPERATIVE|SHALL(?:\s+NOT)?|DO\s+NOT|SHALL)\b/g;

export const perfEmphasisInflation: Rule = {
  id: "perf-emphasis-inflation",
  tier: "deterministic",
  severity: "info",
  description: "Saturated emphasis density (MUST / NEVER / CRITICAL) teaches weak models to ignore emphasis entirely.",
  check(ctx) {
    if (!inHarnessPath(ctx) && !inSharedPrefixPath(ctx)) return [];

    const sections = collectSections(ctx);
    const proseBySection = new Map<SectionInfo, string[]>();
    const append = (section: SectionInfo, text: string): void => {
      const collapsed = collapseWhitespace(text);
      if (!collapsed) return;
      const arr = proseBySection.get(section) ?? [];
      arr.push(collapsed);
      proseBySection.set(section, arr);
    };

    for (const paragraph of paragraphs(getAst(ctx))) {
      append(sectionAt(sections, paragraph.start), paragraph.text);
    }
    for (const list of collectListBlocks(getAst(ctx))) {
      const section = sectionAt(sections, list.start_offset);
      for (const item of list.items) append(section, item.text);
    }

    const findings: LintFinding[] = [];
    for (const section of sections) {
      const chunks = proseBySection.get(section);
      if (!chunks || chunks.length === 0) continue;
      const prose = chunks.join(" ");
      const words = wordCount(prose);
      if (words < 60) continue;

      const count = countMatches(prose, INTENSIFIER_RE);
      if (count < 6) continue;

      const density = (count * 100) / words;
      if (density < 8) continue;

      findings.push(
        findingAt(
          ctx,
          perfEmphasisInflation,
          section.start_offset,
          section.content_start,
          `Section "${section.title}" has ${count} intensifiers in ${words} words (${density.toFixed(1)} per 100). When every rule is CRITICAL, weak models ignore emphasis — reserve MUST/NEVER for a handful of rules.`,
          section.title,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: cross-file duplicate block ------------------------------ */

interface CrossFileBlock {
  text: string;
  wordCount: number;
}

const crossFileIndexCache = new WeakMap<ReadonlyMap<string, string>, Map<string, Set<string>>>();

function isHarnessOrSharedPath(path: string): boolean {
  return HARNESS_PATH_RE.test(path) || SHARED_PREFIX_PATH_RE.test(path);
}

function cheapBlocks(source: string): CrossFileBlock[] {
  const body = stripFrontmatter(source);
  const out: CrossFileBlock[] = [];
  let inFence = false;
  let current: string[] = [];
  const flush = (): void => {
    if (!current.length) return;
    const text = collapseWhitespace(current.join(" "));
    if (text) out.push({ text, wordCount: wordCount(text) });
    current = [];
  };
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (trimmed === "") {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      flush();
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) {
      // List items — skip (covered by runbook rule and likely to false-positive).
      flush();
      continue;
    }
    current.push(trimmed);
  }
  flush();
  return out;
}

function buildCrossFileIndex(sources: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const cached = crossFileIndexCache.get(sources);
  if (cached) return cached;
  const index = new Map<string, Set<string>>();
  for (const [path, source] of sources) {
    if (!isHarnessOrSharedPath(path)) continue;
    for (const block of cheapBlocks(source)) {
      if (block.wordCount < 20) continue;
      const key = normalizeExact(block.text);
      if (!key) continue;
      const set = index.get(key) ?? new Set<string>();
      set.add(path);
      index.set(key, set);
    }
  }
  crossFileIndexCache.set(sources, index);
  return index;
}

function formatFileList(files: string[]): string {
  if (files.length === 1) return `"${files[0]}"`;
  if (files.length === 2) return `"${files[0]}" and "${files[1]}"`;
  return `${files.slice(0, -1).map((f) => `"${f}"`).join(", ")}, and "${files[files.length - 1]}"`;
}

export const perfCrossFileDuplicateBlock: Rule = {
  id: "perf-cross-file-duplicate-block",
  tier: "deterministic",
  severity: "info",
  description: "Paragraphs copy-pasted verbatim across harness files waste tokens and drift as one copy is edited.",
  check(ctx) {
    if (!isHarnessOrSharedPath(ctx.file)) return [];
    if (!ctx.repo_sources || ctx.repo_sources.size < 2) return [];

    const index = buildCrossFileIndex(ctx.repo_sources);
    const sections = collectSections(ctx);
    const findings: LintFinding[] = [];

    for (const paragraph of paragraphs(getAst(ctx))) {
      const text = collapseWhitespace(paragraph.text);
      if (wordCount(text) < 20) continue;
      const section = sectionAt(sections, paragraph.start);
      if (EXAMPLE_TITLE_RE.test(section.title)) continue;
      const key = normalizeExact(text);
      if (!key) continue;
      const files = index.get(key);
      if (!files || files.size < 2) continue;
      const sorted = Array.from(files).sort();
      if (sorted[sorted.length - 1] !== ctx.file) continue;
      const others = sorted.slice(0, -1);

      findings.push(
        findingAt(
          ctx,
          perfCrossFileDuplicateBlock,
          paragraph.start,
          paragraph.end,
          `This paragraph also appears verbatim in ${formatFileList(others)}. Consolidate to one source and link from the others, or move it to a shared include.`,
          truncate(firstSentence(text)),
        ),
      );
    }
    return findings;
  },
};

/** ---- Rule: dense prohibition list ---------------------------------- */

const PROHIBITION_START_RE = /^\s*(?:\*+\s*)?(?:do\s+not|don'?t|never(?:\s+ever)?|must\s+not|shall\s+not|avoid(?:\s+ever)?)\b/i;

export const perfDenseProhibitionList: Rule = {
  id: "perf-dense-prohibition-list",
  tier: "deterministic",
  severity: "info",
  description: "Runs of 3+ prohibition sentences in prose parse worse (and cost more tokens) than a bullet list.",
  examples: [
    {
      bad: "Do not call the API directly. Do not skip validation. Do not retry on 4xx. Never log the raw payload.",
      good: "Never:\n- call the API directly\n- skip validation\n- retry on 4xx\n- log the raw payload",
      why: "Weak models parse explicit lists more reliably and the bullet form is fewer tokens.",
    },
  ],
  check(ctx) {
    if (!inHarnessPath(ctx) && !inSharedPrefixPath(ctx)) return [];

    const findings: LintFinding[] = [];
    for (const paragraph of paragraphs(getAst(ctx))) {
      const slice = ctx.source.slice(paragraph.start, paragraph.end);
      const sentences = tokenizeSentences(slice, []);
      interface Run { start: number; end: number; count: number }
      const runs: Run[] = [];
      let runStart = -1;
      let runEnd = -1;
      let runLen = 0;

      for (const sentence of sentences) {
        if (PROHIBITION_START_RE.test(sentence.text)) {
          if (runLen === 0) runStart = paragraph.start + sentence.start;
          runEnd = paragraph.start + sentence.end;
          runLen++;
        } else {
          if (runLen >= 3) runs.push({ start: runStart, end: runEnd, count: runLen });
          runLen = 0;
        }
      }
      if (runLen >= 3) runs.push({ start: runStart, end: runEnd, count: runLen });

      const best = runs.reduce<Run | null>(
        (acc, r) => (!acc || r.count > acc.count ? r : acc),
        null,
      );
      if (best) {
        findings.push(
          findingAt(
            ctx,
            perfDenseProhibitionList,
            best.start,
            best.end,
            `This paragraph has ${best.count} consecutive prohibition sentences. Convert to a bullet list — shorter and more parseable for weak models.`,
          ),
        );
      }
    }
    return findings;
  },
};

/** ---- Rule: mode-conditional branch in shared prefix ---------------- */

function discoverModeNames(ctx: LintContext): string[] {
  const paths = new Set<string>();
  if (ctx.repo_files) for (const p of ctx.repo_files) paths.add(p);
  if (ctx.repo_sources) for (const p of ctx.repo_sources.keys()) paths.add(p);
  const names = new Set<string>();
  for (const f of paths) {
    const match = /^modes\/([a-z][a-z0-9-]*)\.md$/i.exec(f);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (name.startsWith("_") || name === "readme") continue;
    names.add(name);
  }
  return Array.from(names);
}

export const perfConditionalModeBranchInSharedPrefix: Rule = {
  id: "perf-conditional-mode-branch-in-shared-prefix",
  tier: "deterministic",
  severity: "info",
  description: "Mode-specific `if/when you're in <mode>` branches in shared prefixes should live in the mode's own file.",
  check(ctx) {
    if (!inSharedPrefixPath(ctx)) return [];

    const modes = discoverModeNames(ctx);
    if (modes.length === 0) return [];

    const escape = (m: string): string => m.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    const modeAlt = modes.map(escape).join("|");

    // A sentence must (a) contain a conditional keyword AND (b) name a
    // mode in a clearly-identifying context. Plain word matches like "offer"
    // or "pdf" false-positive on ordinary nouns, so we require either:
    //   - backtick-wrapped reference: `scan`, `apply`
    //   - "<mode> mode/flow/task/runbook/dispatch"
    //   - "dispatch(es|ing|ed) an? <mode>" / "run(s|ning) the <mode>"
    const conditionalRe = /\b(?:if|when|during|whenever|while)\b/i;
    const strongRefRe = new RegExp(
      [
        `\`(?:${modeAlt})\``,
        `\\b(?:${modeAlt})\\s+(?:mode|flow|task|runbook|pipeline|dispatch|subagent)\\b`,
        `\\b(?:dispatch(?:es|ing|ed)?|run(?:s|ning)?|start(?:s|ing)?|invok(?:es|ing))\\s+(?:an?\\s+|the\\s+)?(?:${modeAlt})\\b`,
        `\\b(?:in|during|for|within)\\s+(?:the\\s+|an?\\s+)?(?:${modeAlt})\\s+(?:mode|flow|task|runbook)\\b`,
      ].join("|"),
      "i",
    );

    const sentences = tokenizeSentences(ctx.source, sentenceSkips(ctx));
    const findings: LintFinding[] = [];

    for (const sentence of sentences) {
      const text = collapseWhitespace(sentence.text);
      if (inTableOrHeading(ctx, sentence.start)) continue;
      if (!conditionalRe.test(text)) continue;
      const refMatch = strongRefRe.exec(text);
      if (!refMatch) continue;
      const modeFound = modes.find((m) =>
        new RegExp(`\\b${escape(m)}\\b`, "i").test(refMatch[0]),
      );
      if (!modeFound) continue;
      findings.push(
        findingAt(
          ctx,
          perfConditionalModeBranchInSharedPrefix,
          sentence.start,
          sentence.end,
          `This sentence branches on \`${modeFound}\` mode. Move the branch to \`modes/${modeFound}.md\` so the shared prefix stays mode-agnostic.`,
        ),
      );
    }

    return findings;
  },
};

/** ---- Rule: nested conditional chain -------------------------------- */

const CONDITIONAL_WORD_RE = /\b(?:if|when|unless|whenever|in\s+case)\b/gi;

export const perfNestedConditionalChain: Rule = {
  id: "perf-nested-conditional-chain",
  tier: "deterministic",
  severity: "info",
  description: "Sentences with 3+ nested conditionals (if / when / unless) are hard for weak models to parse reliably.",
  examples: [
    {
      bad: "If the orchestrator is running and when the subagent returns a score, unless the score is below threshold, emit JSON.",
      good: "Emit JSON when the subagent returns a score at or above threshold. Otherwise, skip.",
      why: "Weak models lose track of nested conditions. Linear cases or a decision table are more reliable and shorter.",
    },
  ],
  check(ctx) {
    if (!inHarnessPath(ctx) && !inSharedPrefixPath(ctx)) return [];

    const sentences = tokenizeSentences(ctx.source, sentenceSkips(ctx));
    const findings: LintFinding[] = [];

    for (const sentence of sentences) {
      if (inTableOrHeading(ctx, sentence.start)) continue;
      const count = countMatches(sentence.text, CONDITIONAL_WORD_RE);
      if (count < 3) continue;

      findings.push(
        findingAt(
          ctx,
          perfNestedConditionalChain,
          sentence.start,
          sentence.end,
          `This sentence chains ${count} conditionals (if / when / unless). Split into separate cases or a decision table — weak models lose track of chained conditions.`,
        ),
      );
    }

    return findings;
  },
};

export const PERFORMANCE_RULES: Rule[] = [
  perfRepeatedInstructionBlock,
  perfExampleHeavySection,
  perfDuplicatedOutputRequirement,
  perfStepRestatesPriorStep,
  perfLowValueProseSection,
  perfSharedPrefixBudget,
  perfLargeExampleInSharedPrefix,
  perfLongRunbookInSharedPrefix,
  perfRedundantSchemaProse,
  perfStructuredOutputExplanation,
  perfStyleToneOverhead,
  perfMirroredAgentSpec,
  perfRationaleInSharedPrefix,
  perfEmphasisInflation,
  perfCrossFileDuplicateBlock,
  perfDenseProhibitionList,
  perfConditionalModeBranchInSharedPrefix,
  perfNestedConditionalChain,
];

/**
 * Section + sentence annotation for findings.
 *
 * Walks the source once, building:
 *   - An ordered array of section boundaries (offset, heading text).
 *   - A map of offset → containing sentence (via the sentence tokenizer).
 *
 * Then enriches every finding with `section` and `sentence` fields. Reporters
 * use these to give the user actionable context without opening the file; the
 * LLM rewriter uses the sentence as the rewrite span.
 *
 * Also applies `config.section_severity` overrides: if a finding's section
 * matches a key (case-insensitive), its severity is replaced (or it's dropped
 * entirely if the override is "off").
 */

import type { Sentence } from "./sentences.js";
import { sentenceAt, tokenizeSentences } from "./sentences.js";
import type { LintFinding, ResolvedConfig, Severity } from "./types.js";

interface Section {
  /** Inclusive start offset of the heading line. */
  start: number;
  /** Heading text without leading "#". */
  title: string;
}

/** Parse `## Heading` / `### Heading` lines into section boundaries. */
function parseSections(source: string): Section[] {
  const sections: Section[] = [];
  const re = /^#{1,6}\s+(.+?)\s*$/gm;
  for (const m of source.matchAll(re)) {
    const title = m[1].replace(/^[\d\w]+\s+[-—]\s+/, "").trim();
    sections.push({ start: m.index!, title });
  }
  return sections;
}

/** Return the most-recent heading title at or before `offset`. */
function sectionAt(sections: Section[], offset: number): string | null {
  let lo = 0;
  let hi = sections.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid].start <= offset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best === -1 ? null : sections[best].title;
}

/**
 * Compute the character offset of a finding from its 1-based line/column.
 * Cheap — findings are rare relative to source length.
 */
function offsetOf(source: string, line: number, column: number): number {
  let lineNo = 1;
  let col = 1;
  for (let i = 0; i < source.length; i++) {
    if (lineNo === line && col === column) return i;
    if (source[i] === "\n") {
      lineNo++;
      col = 1;
    } else {
      col++;
    }
  }
  return source.length;
}

export function annotateAndFilter(
  findings: LintFinding[],
  sourceByFile: Map<string, string>,
  skipsByFile: Map<string, [number, number][]>,
  config: ResolvedConfig,
): LintFinding[] {
  const sectionsByFile = new Map<string, Section[]>();
  const sentencesByFile = new Map<string, Sentence[]>();

  const getSections = (file: string): Section[] => {
    let s = sectionsByFile.get(file);
    if (s === undefined) {
      s = parseSections(sourceByFile.get(file) ?? "");
      sectionsByFile.set(file, s);
    }
    return s;
  };
  const getSentences = (file: string): Sentence[] => {
    let s = sentencesByFile.get(file);
    if (s === undefined) {
      const src = sourceByFile.get(file) ?? "";
      s = tokenizeSentences(src, skipsByFile.get(file) ?? []);
      sentencesByFile.set(file, s);
    }
    return s;
  };

  // Lower-cased override map for case-insensitive matching.
  const overrides = Object.entries(config.section_severity ?? {}).reduce<
    Record<string, Severity | "off">
  >((acc, [k, v]) => {
    acc[k.toLowerCase()] = v;
    return acc;
  }, {});

  const out: LintFinding[] = [];
  for (const finding of findings) {
    const source = sourceByFile.get(finding.file) ?? "";
    const offset = offsetOf(source, finding.range.line, finding.range.column);

    const sectionTitle = sectionAt(getSections(finding.file), offset);
    const override = sectionTitle ? overrides[sectionTitle.toLowerCase()] : undefined;
    if (override === "off") continue;

    const containingSentence = sentenceAt(getSentences(finding.file), offset);
    out.push({
      ...finding,
      severity: (override as Severity | undefined) ?? finding.severity,
      ...(sectionTitle ? { section: sectionTitle } : {}),
      ...(containingSentence ? { sentence: containingSentence.text.trim() } : {}),
    });
  }
  return out;
}

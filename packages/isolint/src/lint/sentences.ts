/**
 * Sentence tokenization
 * ---------------------
 * The old rules used /[^.!?\n]+[.!?]/ which mis-split on:
 *   - abbreviations: e.g., i.e., etc., vs., Mr., cf.
 *   - decimals: 0.5, 3.14
 *   - ellipses: ... and …
 *   - URLs: https://example.com/path
 *   - file names: cv.md, plan.json
 *
 * This module returns accurate sentence spans given a source string and
 * a list of offsets to skip (code fences, inline code, HTML comments, etc).
 *
 * A sentence span includes its terminator. Sentences never cross a blank
 * line (paragraph break) — this lets long-sentence and nested-conditional
 * reason about prose chunks without inheriting broken boundaries from list
 * items or headings.
 */

import { isInSkipInterval } from "./source.js";

export interface Sentence {
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** The sentence text (includes the trailing terminator). */
  text: string;
}

const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "e.g", "i.e", "etc", "vs", "cf", "al",
  "Mr", "Mrs", "Ms", "Dr", "Prof", "Jr", "Sr", "St", "Ave",
  "Inc", "Ltd", "Co", "Corp", "LLC",
  "a.m", "p.m", "approx", "No",
]);

const FILE_EXT_PATTERN = /\b\w+\.(md|mdc|mdx|ts|tsx|js|jsx|json|ya?ml|py|go|rs|toml|sh|html|css|scss|xml|txt)\b/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s)\]}>]+|\bwww\.[^\s)\]}>]+/gi;

/**
 * Build a set of offsets where a `.` character is protected — i.e. should
 * not be treated as a sentence terminator. Covers abbreviations, decimals,
 * URLs, and common filenames.
 */
function protectedDotOffsets(source: string): Set<number> {
  const protect = new Set<number>();

  // Decimals: digit.digit.
  const dec = /\d\.\d/g;
  for (const m of source.matchAll(dec)) {
    protect.add(m.index! + 1);
  }

  // URLs (the whole span).
  for (const m of source.matchAll(URL_PATTERN)) {
    for (let i = 0; i < m[0].length; i++) {
      if (m[0][i] === ".") protect.add(m.index! + i);
    }
  }

  // File extensions like cv.md, plan.json, etc.
  for (const m of source.matchAll(FILE_EXT_PATTERN)) {
    const dotIdx = m[0].indexOf(".");
    if (dotIdx !== -1) protect.add(m.index! + dotIdx);
  }

  // Abbreviations: match known tokens followed by ".".
  // Case-sensitive because "No." is an abbreviation but "no." at sentence
  // start is just a short sentence.
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp(`\\b${abbr.replace(/\./g, "\\.")}\\.`, "g");
    for (const m of source.matchAll(re)) {
      // Protect the final dot of the abbreviation.
      protect.add(m.index! + m[0].length - 1);
    }
  }

  return protect;
}

/**
 * Tokenize source into sentence spans. Characters inside any skip interval
 * are ignored by the tokenizer — they appear in no sentence.
 *
 * Rules:
 *   - Sentences end at ".", "!", "?", or a blank line (two consecutive \n).
 *   - "..." and "…" are a single terminator, not three.
 *   - Abbreviations, decimals, URLs, and file extensions don't terminate.
 *   - A single \n does NOT end a sentence (prose may wrap).
 */
export function tokenizeSentences(
  source: string,
  skipIntervals: [number, number][] = [],
): Sentence[] {
  const protectedDots = protectedDotOffsets(source);
  const sentences: Sentence[] = [];

  let sentenceStart = -1;
  let i = 0;
  while (i < source.length) {
    // Skip over protected intervals entirely — they're not part of any sentence.
    if (isInSkipInterval(i, skipIntervals)) {
      if (sentenceStart !== -1) {
        finalize(source, sentences, sentenceStart, i);
        sentenceStart = -1;
      }
      // Jump to the end of the skip interval.
      i = nextSkipEnd(i, skipIntervals);
      continue;
    }

    const c = source[i];

    // Blank line = paragraph break = sentence boundary.
    if (c === "\n" && source[i + 1] === "\n") {
      if (sentenceStart !== -1) {
        finalize(source, sentences, sentenceStart, i);
        sentenceStart = -1;
      }
      i += 2;
      continue;
    }

    // Skip leading whitespace between sentences.
    if (sentenceStart === -1) {
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i++;
        continue;
      }
      sentenceStart = i;
    }

    if ((c === "." || c === "!" || c === "?") && !protectedDots.has(i)) {
      // Ellipsis: run of dots treated as one terminator.
      let j = i;
      if (c === ".") {
        while (source[j + 1] === ".") j++;
      }
      const next = source[j + 1];
      // Terminator only counts if followed by whitespace / EOF / closing quote.
      if (next === undefined || /[\s)\]}'"”]/.test(next)) {
        finalize(source, sentences, sentenceStart, j + 1);
        sentenceStart = -1;
        i = j + 1;
        continue;
      }
      i = j + 1;
      continue;
    }

    i++;
  }

  if (sentenceStart !== -1) {
    finalize(source, sentences, sentenceStart, source.length);
  }

  return sentences;
}

function finalize(
  source: string,
  out: Sentence[],
  start: number,
  end: number,
): void {
  // Trim trailing whitespace from end.
  let actualEnd = end;
  while (actualEnd > start && /\s/.test(source[actualEnd - 1])) actualEnd--;
  if (actualEnd <= start) return;
  // Trim leading whitespace.
  let actualStart = start;
  while (actualStart < actualEnd && /\s/.test(source[actualStart])) actualStart++;
  if (actualStart >= actualEnd) return;
  const text = source.slice(actualStart, actualEnd);
  // Drop sentences that are only list markers or heading prefixes.
  if (/^[#>*+\-|]\s*$/.test(text)) return;
  out.push({ start: actualStart, end: actualEnd, text });
}

function nextSkipEnd(offset: number, intervals: [number, number][]): number {
  for (const [s, e] of intervals) {
    if (offset >= s && offset < e) return e;
  }
  return offset + 1;
}

/**
 * Find the sentence containing a given offset. O(log n) with binary search.
 * Returns null if the offset is inside a skip interval or between sentences.
 */
export function sentenceAt(
  sentences: Sentence[],
  offset: number,
): Sentence | null {
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sentences[mid];
    if (offset < s.start) hi = mid - 1;
    else if (offset >= s.end) lo = mid + 1;
    else return s;
  }
  return null;
}

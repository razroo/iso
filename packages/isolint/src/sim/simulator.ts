/**
 * Small-model simulator
 * ---------------------
 * Deterministic behavior model that codifies the known failure modes of
 * weak (7B-class) language models when they execute a markdown harness.
 * Used by regression-sim tests to prove that isolint's rewrites reduce
 * broken behaviors, not just reduce lint findings.
 *
 * The simulator walks each sentence-like instruction in the harness and
 * decides whether the small model would:
 *   - FOLLOW it (the sentence is unambiguous)
 *   - DROP it (contains `should`/`could`/`might`/`consider`)
 *   - INVENT past it (contains `etc.` / `and so on` / unclosed enum)
 *   - SKIP the condition (contains `when relevant` / `if appropriate`)
 *   - PARTIALLY FOLLOW (sentence is > 35 words — middle clause dropped)
 *   - HALLUCINATE a reference (`$input.X` with no declared X)
 *
 * The simulator returns a structured trace so regression tests can assert
 * specific behaviors are absent after `isolint --fix`.
 *
 * NOTE: the simulator is NOT a real LLM. It's a deterministic behavior
 * model whose failure catalog matches what the deterministic rules catch.
 * If rules + simulator are in sync, fixes by definition reduce trace
 * failures. The value is the *framing*: isolint users can quote a concrete
 * number ("your harness has 24 likely small-model break points").
 */

import { tokenizeSentences } from "../lint/sentences.js";
import { computeSkipIntervals } from "../lint/source.js";
import { DEFAULT_CONFIG } from "../lint/config.js";

export type TraceAction =
  | "follow"
  | "drop"
  | "invent-item"
  | "skip-conditional"
  | "partial"
  | "hallucinate-ref";

export interface TraceEvent {
  action: TraceAction;
  sentence: string;
  reason: string;
  line: number;
}

export interface SimulationTrace {
  events: TraceEvent[];
  followed: number;
  failed: number;
  /** Scalar 0..1 — failed / (followed+failed). 0 = perfect, 1 = fully broken. */
  fragility: number;
}

export interface SimulateOptions {
  /** Set of $input / $steps keys that the simulator can resolve. Empty = nothing declared. */
  declared_refs?: Set<string>;
  /** Max words before a sentence starts "losing the middle". Default 35. */
  long_sentence_threshold?: number;
}

/**
 * Run the simulator over a harness source. Returns a trace of what a weak
 * model would do sentence-by-sentence.
 */
export function simulate(source: string, opts: SimulateOptions = {}): SimulationTrace {
  const threshold = opts.long_sentence_threshold ?? 35;
  const declared = opts.declared_refs ?? new Set<string>();

  const skips = computeSkipIntervals(source, DEFAULT_CONFIG.skip_spans);
  const sentences = tokenizeSentences(source, skips);

  const events: TraceEvent[] = [];
  let followed = 0;
  let failed = 0;

  const lineOf = (offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === "\n") line++;
    }
    return line;
  };

  for (const s of sentences) {
    const text = s.text;
    const low = text.toLowerCase();
    const line = lineOf(s.start);

    // Skip headings and list-marker-only sentences — they're structural, not instructions.
    if (/^[#>*+\-|]/.test(text.trim())) continue;

    let broke = false;

    // (a) soft imperative → dropped
    if (/\b(should|could|might|consider|perhaps|ideally)\b/i.test(text)) {
      events.push({
        action: "drop",
        sentence: text,
        reason: "weak model ignores soft imperatives",
        line,
      });
      broke = true;
    }

    // (b) trailing etc → invent an item
    if (/\b(etc\.?|and so on|and such)\b/i.test(text)) {
      events.push({
        action: "invent-item",
        sentence: text,
        reason: "weak model invents a 4th item past the open set",
        line,
      });
      broke = true;
    }

    // (c) implicit conditional → condition skipped
    if (/\b(when relevant|as needed|if appropriate|when appropriate)\b/i.test(low)) {
      events.push({
        action: "skip-conditional",
        sentence: text,
        reason: "weak model can't evaluate vague conditional; treats it as never",
        line,
      });
      broke = true;
    }

    // (d) long sentence → partial follow
    const wordCount = text.replace(/[*_`]+/g, "").split(/\s+/).filter(Boolean).length;
    if (wordCount > threshold) {
      events.push({
        action: "partial",
        sentence: text,
        reason: `sentence has ${wordCount} words; weak model drops a middle clause`,
        line,
      });
      broke = true;
    }

    // (e) dangling $input / $steps reference → hallucinate
    const refs = [...text.matchAll(/\$(input|steps|env|state)\.([\w.]+)/g)];
    for (const r of refs) {
      const key = r[2].split(".")[0];
      if (!declared.has(key)) {
        events.push({
          action: "hallucinate-ref",
          sentence: text,
          reason: `"$${r[1]}.${r[2]}" has no declared source; weak model invents a value`,
          line,
        });
        broke = true;
        break;
      }
    }

    if (broke) failed++;
    else {
      followed++;
      events.push({ action: "follow", sentence: text, reason: "clean", line });
    }
  }

  const total = followed + failed;
  const fragility = total === 0 ? 0 : failed / total;
  return { events, followed, failed, fragility };
}

/**
 * Shape summary: return failure counts by action — useful for assertions
 * like "before fix: 4 drops, 2 invents; after fix: 0 drops, 0 invents".
 */
export function summarize(trace: SimulationTrace): Record<TraceAction, number> {
  const out: Record<TraceAction, number> = {
    follow: 0, drop: 0, "invent-item": 0, "skip-conditional": 0, partial: 0, "hallucinate-ref": 0,
  };
  for (const e of trace.events) out[e.action]++;
  return out;
}

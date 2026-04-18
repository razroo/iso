/**
 * Tier 1 rules: deterministic, zero-cost, regex-based.
 *
 * Each rule flags a pattern that weak models (Minimax 2.5, Nemotron 3,
 * Mistral 7B, local models) reliably fail on. Rules intentionally err
 * on the side of false positives that are easy to dismiss — missing a
 * failure mode is far more expensive than an extra warning.
 *
 * Every rule skips fenced code blocks, inline code, and HTML comments
 * via the skip intervals built by computeSkipIntervals.
 */

import {
  collectHeadings,
  collectLinks,
  collectLists,
  collectTables,
  findInvalidJsonFences,
  getAst,
} from "../ast.js";
import { dirname, resolve, isAbsolute } from "node:path";
import { frontmatterSchema } from "./frontmatter.js";
import { sentenceAt, tokenizeSentences } from "../sentences.js";
import { computeSkipIntervals, rangeFromOffsets, scanMatches } from "../source.js";
import type { Fix, LintContext, LintFinding, Rule } from "../types.js";

function findingsFrom(
  ctx: LintContext,
  rule: { id: string; severity: "error" | "warn" | "info" },
  matches: Array<{ start: number; end: number; message: string; fix?: Fix; llm_fixable?: boolean }>,
): LintFinding[] {
  return matches.map(({ start, end, message, fix, llm_fixable }) => ({
    rule_id: rule.id,
    severity: rule.severity,
    file: ctx.file,
    range: rangeFromOffsets(ctx, start, end),
    message,
    snippet: ctx.source.slice(start, end),
    ...(fix ? { fix } : {}),
    ...(llm_fixable ? { llm_fixable: true } : {}),
  }));
}

function skip(ctx: LintContext) {
  return computeSkipIntervals(ctx.source, ctx.config.skip_spans);
}

/** ---- Rule: soft-imperative ------------------------------------------ */

export const softImperative: Rule = {
  id: "soft-imperative",
  tier: "deterministic",
  severity: "warn",
  description: "Use MUST / ALWAYS / NEVER instead of should / might / could / consider.",
  examples: [
    {
      bad: "You should validate the input before saving.",
      good: "Validate the input before saving. If validation fails, return `{ok: false}` and skip the save.",
      why: "Replace 'should' with a direct imperative and state the failure path explicitly.",
    },
    {
      bad: "Consider checking the schema first.",
      good: "Check the schema first. If any required field is missing, return an error.",
      why: "'Consider' is optional; small models skip it. State the action as a MUST-do and define the failure case.",
    },
  ],
  check(ctx) {
    const words = ["should", "could", "might", "may want to", "consider", "perhaps", "probably", "ideally", "preferably"];
    const re = new RegExp(`\\b(${words.join("|")})\\b`, "gi");
    const skips = skip(ctx);
    const sentences = tokenizeSentences(ctx.source, skips);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skips)) {
      const containing = sentenceAt(sentences, m.index);
      // Skip interrogative sentences — "What story should they tell?" isn't an instruction.
      if (containing && containing.text.endsWith("?")) continue;
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" is a soft imperative; weak models treat it as optional. Use MUST / ALWAYS / NEVER or drop it.`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, softImperative, matches);
  },
};

/** ---- Rule: vague-quantifier ----------------------------------------- */

export const vagueQuantifier: Rule = {
  id: "vague-quantifier",
  tier: "deterministic",
  severity: "warn",
  description: "Use an exact number instead of some / several / a few / many / most.",
  examples: [
    {
      bad: "Extract a few key fields from the JD.",
      good: "Extract exactly 5 fields from the JD: `title`, `seniority`, `comp_min`, `comp_max`, `location`.",
      why: "Replace 'a few' with an exact count and enumerate the fields.",
    },
  ],
  check(ctx) {
    const re = /\b(some|several|a few|many|most of|a number of|numerous|various)\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" has no operational meaning. Give a number, a range, or an upper bound.`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, vagueQuantifier, matches);
  },
};

/** ---- Rule: taste-word ------------------------------------------------ */

export const tasteWord: Rule = {
  id: "taste-word",
  tier: "deterministic",
  severity: "warn",
  description: "Remove taste-based words; weak models can't evaluate them.",
  examples: [
    {
      bad: "Write a creative subject line that is engaging.",
      good: "Write a subject line, max 60 characters, containing the company name and the role archetype.",
      why: "'Creative' and 'engaging' are untestable. Use measurable constraints: length, required substrings, or a regex.",
    },
  ],
  check(ctx) {
    const builtin = [
      "creative",
      "engaging",
      "appropriate",
      "polished",
      "natural",
      "nice",
      "good",
      "great",
      "feel free",
      "as needed",
      "when relevant",
      "if appropriate",
      "as appropriate",
      "passionate",
      "leveraged",
      "utilized",
      "spearheaded",
      "cutting-edge",
      "world-class",
      "best-in-class",
      "robust",
      "seamless",
      "synergy",
      "holistic",
    ];
    const extra = (ctx.config.options["taste-word.extra"] as string[] | undefined) ?? [];
    const words = [...builtin, ...extra];
    const re = new RegExp(`\\b(${words.map(escapeRe).join("|")})\\b`, "gi");
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" is taste-based; weak models can't evaluate it. Replace with a measurable rule.`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, tasteWord, matches);
  },
};

/** ---- Rule: ambiguous-deictic ---------------------------------------- */

export const ambiguousDeictic: Rule = {
  id: "ambiguous-deictic",
  tier: "deterministic",
  severity: "info",
  description: "Prefer explicit refs over 'above' / 'below' / 'the following' — weak models lose position.",
  check(ctx) {
    const re = /\b(the section above|section below|above section|below section|as mentioned above|as noted above|as described below|the table above|the table below)\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" relies on position. Name the section explicitly (e.g., "Block A — Role Summary").`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, ambiguousDeictic, matches);
  },
};

/** ---- Rule: double-negation ------------------------------------------ */

export const doubleNegation: Rule = {
  id: "double-negation",
  tier: "deterministic",
  severity: "warn",
  description: "Avoid double negatives — weak models flip the sign.",
  check(ctx) {
    const re = /\b(don'?t\s+(?:forget\s+to\s+)?(?:not|never)|never\s+(?:not|fail to)|not\s+un\w+|cannot\s+not)\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `Double negative: "${m[0]}". Rewrite as a positive imperative.`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, doubleNegation, matches);
  },
};

/** ---- Rule: long-sentence -------------------------------------------- */

export const longSentence: Rule = {
  id: "long-sentence",
  tier: "deterministic",
  severity: "info",
  description: "Split sentences longer than N words — weak models drop clauses.",
  check(ctx) {
    const max = (ctx.config.options["long-sentence.max_words"] as number | undefined) ?? 35;
    const skips = skip(ctx);
    const sentences = tokenizeSentences(ctx.source, skips);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];

    for (const s of sentences) {
      const text = s.text.trim();
      if (text.startsWith("#") || text.startsWith(">")) continue;
      if (text.startsWith("|") || text.startsWith("- ") || text.startsWith("* ")) continue;
      // Strip markdown emphasis and inline-code backticks before counting
      // so **word** is one word, not two and not zero.
      const stripped = text.replace(/[*_`]+/g, "");
      const words = stripped.split(/\s+/).filter(Boolean);
      if (words.length > max) {
        matches.push({
          start: s.start,
          end: s.end,
          message: `Sentence is ${words.length} words (max ${max}). Split into shorter statements.`,
          llm_fixable: true,
        });
      }
    }
    return findingsFrom(ctx, longSentence, matches);
  },
};

/** ---- Rule: pronoun-no-antecedent ------------------------------------ */

export const pronounNoAntecedent: Rule = {
  id: "pronoun-no-antecedent",
  tier: "deterministic",
  severity: "info",
  description: "Pronoun at the start of a sentence after a list/heading — weak models lose the antecedent.",
  check(ctx) {
    const lines = ctx.source.split("\n");
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = lines[i - 1] ?? "";
      const trimmed = line.trimStart();
      const leading = line.length - trimmed.length;
      const start = offset + leading;

      const prevIsStructural =
        prev.trim() === "" ||
        prev.trim().startsWith("#") ||
        prev.trim().startsWith("|") ||
        prev.trim().startsWith("-") ||
        prev.trim().startsWith("*") ||
        prev.trim().startsWith("```");

      if (prevIsStructural) {
        const m = /^(It|This|That|They|These|Those)\b/.exec(trimmed);
        if (m) {
          matches.push({
            start,
            end: start + m[0].length,
            message: `"${m[0]}" at start of block has no clear antecedent. Name the noun explicitly.`,
            llm_fixable: true,
          });
        }
      }
      offset += line.length + 1;
    }
    const skips = skip(ctx);
    const filtered = matches.filter((m) => !skips.some(([s, e]) => m.start >= s && m.start < e));
    return findingsFrom(ctx, pronounNoAntecedent, filtered);
  },
};

/** ---- Rule: enum-without-list ---------------------------------------- */

export const enumWithoutList: Rule = {
  id: "enum-without-list",
  tier: "deterministic",
  severity: "warn",
  description: "Phrases like 'one of the usual/standard' must list the allowed values inline.",
  check(ctx) {
    const re = /\bone of (?:the )?(?:usual|standard|typical|common|known) (?:categories|values|options|types)\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `Enum referenced without values. List the allowed values inline: "one of [a, b, c]".`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, enumWithoutList, matches);
  },
};

/** ---- Rule: word-count-target ---------------------------------------- */

export const wordCountTarget: Rule = {
  id: "word-count-target",
  tier: "deterministic",
  severity: "info",
  description: "Prefer character / sentence counts over word counts — weak models count tokens poorly.",
  check(ctx) {
    const re = /\b(\d+)[-–—]?(?:\s*(?:to|-)\s*\d+)?\s*words?\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" — weak models count words unreliably. Prefer characters ("max 240 chars") or sentences ("2-3 sentences").`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, wordCountTarget, matches);
  },
};

/** ---- Rule: implicit-conditional ------------------------------------- */

export const implicitConditional: Rule = {
  id: "implicit-conditional",
  tier: "deterministic",
  severity: "warn",
  description: "Conditional with no operational trigger (when/if relevant, as needed, if appropriate).",
  examples: [
    {
      bad: "Emit a warning when relevant.",
      good: "Emit a warning when the `confidence` score is below `0.6`.",
      why: "Make the trigger explicit. Weak models guess 'relevant' in different ways per call.",
    },
  ],
  check(ctx) {
    const re = /\b(when (?:relevant|appropriate|needed|necessary)|as (?:needed|appropriate)|if (?:relevant|appropriate|needed|necessary)|where (?:relevant|appropriate|needed))\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" has no operational trigger. State the exact condition ("if score >= 3.5", "if the field is missing").`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, implicitConditional, matches);
  },
};

/** ---- Rule: trailing-etc --------------------------------------------- */

export const trailingEtc: Rule = {
  id: "trailing-etc",
  tier: "deterministic",
  severity: "warn",
  description: "'etc.' in an instruction is an unclosed set — list the allowed values explicitly.",
  examples: [
    {
      bad: "Classify the role as junior, mid, senior, etc.",
      good: "Classify the role as exactly one of: `junior`, `mid`, `senior`, `staff`, `principal`.",
      why: "Close the set. Weak models invent values past 'etc.'",
    },
  ],
  check(ctx) {
    const re = /\b(etc\.?|and so on|and such)\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" leaves the set open. Weak models invent items. List every allowed value explicitly.`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, trailingEtc, matches);
  },
};

/** ---- Rule: heading-without-imperative ------------------------------- */

export const headingWithoutImperative: Rule = {
  id: "heading-without-imperative",
  tier: "deterministic",
  severity: "info",
  description: "Mode/step headings should begin with an imperative verb.",
  check(ctx) {
    if (!ctx.file.match(/modes\/|prompts\/|skills\/|agents\//i)) return [];
    const lines = ctx.source.split("\n");
    const skips = skip(ctx);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    let offset = 0;
    const verbPattern = /^(Read|Write|Emit|Return|Extract|Classify|Generate|Validate|Compute|Save|Load|Scan|Detect|Build|Call|Fetch|Check|Verify|Update|Append|Skip|Fail|Use|Do|List|Count|Sum|Run|Execute|Apply|Parse|Render|Match|Map|Filter|Sort|Select|Pick|Output|Print|Dispatch|Route|Copy|Resolve|Compare|Score|Ignore|Ask|Reply|Include|Exclude)\b/;
    for (const line of lines) {
      const m = /^\s*(##+)\s+(Step\s+\d+\s*[—-]\s*|Block\s+[A-Z]\s*[—-]\s*)?(.+?)\s*$/.exec(line);
      if (m) {
        const headingText = m[3].trim();
        const headStart = offset + (m.index ?? 0) + line.indexOf(headingText);
        if (
          !verbPattern.test(headingText) &&
          !headingText.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/) &&
          !skips.some(([s, e]) => headStart >= s && headStart < e)
        ) {
          matches.push({
            start: headStart,
            end: headStart + headingText.length,
            message: `Heading "${headingText}" does not start with an imperative verb. Weak models skip non-actionable headings.`,
            llm_fixable: true,
          });
        }
      }
      offset += line.length + 1;
    }
    return findingsFrom(ctx, headingWithoutImperative, matches);
  },
};

/** ---- Rule: nested-conditional --------------------------------------- */

export const nestedConditional: Rule = {
  id: "nested-conditional",
  tier: "deterministic",
  severity: "warn",
  description: "Multiple if/unless/except in one sentence — split into a decision table or ordered list.",
  check(ctx) {
    const skips = skip(ctx);
    const sentences = tokenizeSentences(ctx.source, skips);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const s of sentences) {
      const text = s.text;
      const count =
        (text.match(/\bif\b/gi)?.length ?? 0) +
        (text.match(/\bunless\b/gi)?.length ?? 0) +
        (text.match(/\bexcept\b/gi)?.length ?? 0) +
        (text.match(/\bwhen\b/gi)?.length ?? 0);
      if (count >= 3) {
        matches.push({
          start: s.start,
          end: s.end,
          message: `Sentence has ${count} conditional clauses. Rewrite as a decision table or ordered if/else-if list.`,
          llm_fixable: true,
        });
      }
    }
    return findingsFrom(ctx, nestedConditional, matches);
  },
};

/** ---- Rule: multiple-output-formats ---------------------------------- */

export const multipleOutputFormats: Rule = {
  id: "multiple-output-formats",
  tier: "deterministic",
  severity: "warn",
  description: "One step must return one format — don't ask for JSON and also a summary.",
  check(ctx) {
    const re = /\b(return|output|emit|produce)\b[^.!?\n]{0,120}\b(and\s+(?:also|then))\b[^.!?\n]{0,120}\b(summary|explanation|commentary|markdown|prose|json|list|yaml)\b/gi;
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const m of scanMatches(ctx.source, re, skip(ctx))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `Step asks for two output formats. Weak models drop one. Split into two steps.`,
        llm_fixable: true,
      });
    }
    return findingsFrom(ctx, multipleOutputFormats, matches);
  },
};

/** ---- Rule: output-format-no-example --------------------------------- */

/**
 * Flags "return/output JSON/YAML" declarations with no example or schema
 * within a short lookahead. Weak models hallucinate the shape without one.
 *
 * Satisfied by any of (within the next 10 lines):
 *   - a fenced code block
 *   - ≥2 bullet list items (treated as a schema / field list)
 *   - an inline JSON-shaped object on the same line (`{ ... }`)
 */
export const outputFormatNoExample: Rule = {
  id: "output-format-no-example",
  tier: "deterministic",
  severity: "warn",
  description: "Output-format declarations must be followed by an example or field list.",
  check(ctx) {
    const source = ctx.source;
    const skips = skip(ctx);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    const decl = /\b(return|returns|returning|output|outputs|emit|emits|produce|produces|respond with)\s+(?:a\s+|an\s+|the\s+)?(JSON|YAML|XML|TOML|CSV)\b/gi;
    const lineStarts = ctx.line_starts;

    for (const m of scanMatches(source, decl, skips)) {
      const declLine = findLine(lineStarts, m.index);
      const targetLine = declLine + 10;
      const lookaheadEnd = targetLine >= lineStarts.length ? source.length : lineStarts[targetLine];
      const windowText = source.slice(m.index, lookaheadEnd);

      const hasCodeFence = /^(```+|~~~+)/m.test(windowText);
      const hasInlineObject = /\{[\s\S]{1,200}?\}/.test(windowText);
      const bulletMatches = windowText.match(/^\s*[-*+]\s/gm);
      const hasBulletList = (bulletMatches?.length ?? 0) >= 2;
      // Inline backtick-quoted field names: "Return JSON with a `name` field
      // (string) and a `score` field" is a schema hint, not hallucination bait.
      const inlineFields = windowText.match(/`[A-Za-z_][\w.]*`/g);
      const hasInlineFields = (inlineFields?.length ?? 0) >= 2;

      if (!hasCodeFence && !hasInlineObject && !hasBulletList && !hasInlineFields) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          message: `"${m[0]}" has no example or field list nearby. Weak models hallucinate the shape. Add a fenced example or a bullet list of fields.`,
          llm_fixable: true,
        });
      }
    }
    return findingsFrom(ctx, outputFormatNoExample, matches);
  },
};

/** ---- Rule: numbered-step-gap ---------------------------------------- */

/**
 * Detects broken step numbering at the same indentation level:
 *   1. Do X
 *   2. Do Y
 *   4. Do Z     ← jumps from 2 to 4 (missing 3)
 *
 * Weak models inherit the gap — they skip the corresponding step. Reports the
 * first missing number only (users usually fix numbering manually).
 */
export const numberedStepGap: Rule = {
  id: "numbered-step-gap",
  tier: "deterministic",
  severity: "warn",
  description: "Numbered lists with gaps — weak models follow structural errors.",
  check(ctx) {
    const source = ctx.source;
    const skips = skip(ctx);
    const lines = source.split("\n");
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];

    interface Run {
      /** Indentation (whitespace prefix length). */
      indent: number;
      last: number;
      lineIdx: number;
      offset: number;
    }
    let run: Run | null = null;
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^(\s*)(\d+)\.\s/.exec(line);
      if (m) {
        const indent = m[1].length;
        const num = parseInt(m[2], 10);
        const itemOffset = offset + indent;
        if (run && run.indent === indent) {
          if (num !== run.last + 1 && num > run.last) {
            if (!skips.some(([s, e]) => itemOffset >= s && itemOffset < e)) {
              matches.push({
                start: itemOffset,
                end: itemOffset + m[0].length - 1,
                message: `Numbered list jumps from ${run.last} to ${num}. Weak models inherit the gap and skip the step.`,
              });
            }
            run = { indent, last: num, lineIdx: i, offset: itemOffset };
          } else {
            run.last = num;
          }
        } else {
          run = { indent, last: num, lineIdx: i, offset: itemOffset };
        }
      } else if (line.trim() === "" && run) {
        // A blank line breaks a list run — reset.
        run = null;
      }
      offset += line.length + 1;
    }
    return findingsFrom(ctx, numberedStepGap, matches);
  },
};

/** ---- Rule: step-without-verb ---------------------------------------- */

/**
 * A "## Step N" heading whose body doesn't open with an imperative verb.
 * Weak models skim step bodies looking for a verb to anchor on — "Configuration
 * of the pipeline" loses them; "Configure the pipeline" doesn't.
 *
 * Only runs on harness-file paths (modes/, prompts/, skills/, agents/).
 */
export const stepWithoutVerb: Rule = {
  id: "step-without-verb",
  tier: "deterministic",
  severity: "info",
  description: "Step bodies should open with an imperative verb, not a noun or description.",
  check(ctx) {
    if (!ctx.file.match(/modes\/|prompts\/|skills\/|agents\/|\.cursor\/rules/i)) return [];
    const source = ctx.source;
    const lines = source.split("\n");
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    const verbStart = /^(?:\*\*)?(?:Read|Write|Emit|Return|Extract|Classify|Generate|Validate|Compute|Save|Load|Scan|Detect|Build|Call|Fetch|Check|Verify|Update|Append|Skip|Fail|Use|Do|List|Count|Sum|Run|Execute|Apply|Parse|Render|Match|Map|Filter|Sort|Select|Pick|Output|Print|Dispatch|Route|Copy|Resolve|Compare|Score|Ignore|Ask|Reply|Include|Exclude|Configure|Set|Create|Add|Remove|Replace|Modify|Split|Join|Merge|Evaluate|Decide|Choose|Assign|Test|Try|Confirm|Normalize|Convert|Format|Sanitize|Deduplicate|Identify)\b/;
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const heading = /^##+\s+(?:Step|Block)\s+[A-Z0-9]+\s*[—\-:]\s*.+$/.exec(lines[i]);
      if (heading) {
        // Find the first non-empty, non-heading line in the body.
        let j = i + 1;
        let bodyOffset = offset + lines[i].length + 1;
        while (j < lines.length) {
          const body = lines[j];
          if (body.trim() !== "" && !/^#+\s/.test(body)) {
            const trimmed = body.replace(/^\s*[-*+]\s+/, "").trimStart();
            if (!verbStart.test(trimmed)) {
              const firstNonSpace = body.length - body.trimStart().length;
              matches.push({
                start: bodyOffset + firstNonSpace,
                end: bodyOffset + body.length,
                message: `Step body opens without an imperative verb: "${truncate(trimmed, 60)}". Weak models need a verb to anchor on.`,
                llm_fixable: true,
              });
            }
            break;
          }
          bodyOffset += body.length + 1;
          j++;
        }
      }
      offset += lines[i].length + 1;
    }
    return findingsFrom(ctx, stepWithoutVerb, matches);
  },
};

/** ---- Rule: heading-hierarchy ---------------------------------------- */

/**
 * Flags heading depth jumps (e.g. `# A` → `### B` skipping `##`). Weak
 * models read heading depth as structural hierarchy; a skipped level is
 * treated as "end of the previous section" and the body gets orphaned.
 */
export const headingHierarchy: Rule = {
  id: "heading-hierarchy",
  tier: "deterministic",
  severity: "info",
  description: "Heading depth jumps confuse weak models' hierarchy reading.",
  check(ctx) {
    const ast = getAst(ctx);
    const heads = collectHeadings(ast);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    let prev = 0;
    for (const h of heads) {
      if (prev !== 0 && h.depth > prev + 1) {
        matches.push({
          start: h.start_offset,
          end: h.end_offset,
          message: `Heading "${h.text}" is depth ${h.depth} but previous heading was depth ${prev}. Skipped level ${prev + 1}.`,
        });
      }
      prev = h.depth;
    }
    return findingsFrom(ctx, headingHierarchy, matches);
  },
};

/** ---- Rule: stale-link-reference ------------------------------------- */

/**
 * Markdown-link version of `missing-file-reference`: `[label](./missing.md)`
 * where the target doesn't exist. Handles relative paths (resolved against
 * the harness file's directory) and URL-encoded paths. Skips http(s):// and
 * mailto: URLs, and anchor-only links (`#section`).
 */
export const staleLinkReference: Rule = {
  id: "stale-link-reference",
  tier: "deterministic",
  severity: "warn",
  description: "Markdown link targets a local file that doesn't exist.",
  check(ctx) {
    if (!ctx.repo_files) return [];
    const ast = getAst(ctx);
    const links = collectLinks(ast);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const link of links) {
      const url = link.url;
      if (!url) continue;
      if (/^(https?|mailto|tel|data):/i.test(url)) continue;
      // Strip anchor + query.
      const pathOnly = url.replace(/[#?].*$/, "");
      if (!pathOnly) continue;
      if (isAbsolute(pathOnly)) continue; // absolute fs paths out of repo scope
      // Resolve relative to the harness file's directory.
      const fileDir = dirname(ctx.file);
      const resolved = resolve("/" + fileDir, pathOnly).slice(1); // strip leading / for set lookup
      // Use the set of known repo files (basename match for leniency).
      if (ctx.repo_files.has(resolved)) continue;
      // Basename fallback.
      const slash = resolved.lastIndexOf("/");
      const base = slash === -1 ? resolved : resolved.slice(slash + 1);
      let found = false;
      for (const p of ctx.repo_files) {
        if (p === resolved || p.endsWith("/" + base) || p === base) {
          found = true;
          break;
        }
      }
      if (!found) {
        matches.push({
          start: link.start_offset,
          end: link.end_offset,
          message: `Link "[${link.label}](${url})" points to a file that doesn't exist in the repo.`,
        });
      }
    }
    return findingsFrom(ctx, staleLinkReference, matches);
  },
};

/** ---- Rule: table-column-mismatch ------------------------------------ */

/**
 * Table rows with a different cell count than the header. Weak models
 * inherit the broken shape and emit malformed tables in response.
 */
export const tableColumnMismatch: Rule = {
  id: "table-column-mismatch",
  tier: "deterministic",
  severity: "warn",
  description: "Table rows must have the same column count as the header.",
  check(ctx) {
    const ast = getAst(ctx);
    const tables = collectTables(ast);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const t of tables) {
      for (const row of t.rows) {
        if (row.cells !== t.header_cells) {
          matches.push({
            start: row.start_offset,
            end: row.end_offset,
            message: `Table row has ${row.cells} cells but header has ${t.header_cells}. Rows must match header.`,
          });
        }
      }
    }
    return findingsFrom(ctx, tableColumnMismatch, matches);
  },
};

/** ---- Rule: mixed-list-marker ---------------------------------------- */

/**
 * One unordered list mixing bullet markers (`-` and `*` together). Weak
 * models treat inconsistent markers as semantic — often splitting what
 * should be one list into two sequences.
 */
export const mixedListMarker: Rule = {
  id: "mixed-list-marker",
  tier: "deterministic",
  severity: "info",
  description: "A single list mixes `-` and `*` bullet markers — weak models split on the change.",
  check(ctx) {
    const ast = getAst(ctx);
    const lists = collectLists(ast, ctx.source);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    for (const l of lists) {
      if (l.ordered) continue;
      const distinct = new Set(l.markers);
      if (distinct.size > 1) {
        matches.push({
          start: l.start_offset,
          end: l.end_offset,
          message: `List mixes bullet markers: ${[...distinct].map((m) => `"${m}"`).join(", ")}. Pick one.`,
        });
      }
    }
    return findingsFrom(ctx, mixedListMarker, matches);
  },
};

/** ---- Rule: invalid-json-fence --------------------------------------- */

/**
 * AST-powered rule: a ```json fence whose body isn't valid JSON. Weak models
 * look at fenced examples as the source of truth; a malformed example
 * guarantees malformed output.
 *
 * This is the first rule that uses the markdown AST instead of regex — it's
 * impossible to check reliably without parsing the document structurally.
 */
export const invalidJsonFence: Rule = {
  id: "invalid-json-fence",
  tier: "deterministic",
  severity: "warn",
  description: "```json example block doesn't parse as JSON — weak models copy the malformed shape.",
  examples: [
    {
      bad: '```json\n{ name: "alice" }\n```',
      good: '```json\n{ "name": "alice" }\n```',
      why: "JSON requires double-quoted keys. Weak models emit whatever shape the fenced example shows.",
    },
  ],
  check(ctx) {
    const ast = getAst(ctx);
    const problems = findInvalidJsonFences(ast);
    return problems.map<LintFinding>((p) => ({
      rule_id: invalidJsonFence.id,
      severity: "warn",
      file: ctx.file,
      range: rangeFromOffsets(ctx, p.start_offset, p.end_offset),
      message: `\`\`\`${p.language} fence does not parse as JSON: ${p.error}. Fix the example or weak models will copy the malformed shape.`,
      snippet: ctx.source.slice(p.start_offset, Math.min(p.end_offset, p.start_offset + 60)),
    }));
  },
};

/** ---- Rule: dangling-variable-reference ------------------------------ */

/**
 * Flags `$input.X`, `$steps.Y.output`, `$env.Z`, `$state.W` references that
 * have no source declared in the harness. Weak models invent the value when
 * the reference has nowhere to resolve from.
 *
 * Sources the rule recognizes:
 *   - An `input_schema` / `input:` YAML block with properties: field names
 *   - Heading-level step ids: `## Step <id>` → `$steps.<id>.*`
 *   - Inline declarations: `$env.FOO` is considered declared if the source
 *     also shows `FOO=` in a fenced bash block or `env:` YAML block
 *
 * The rule is conservative: if the file declares no input schema AND no
 * step ids, it doesn't fire (the file probably uses a convention we don't
 * recognize and we'd rather not false-positive).
 */
export const danglingVariableReference: Rule = {
  id: "dangling-variable-reference",
  tier: "deterministic",
  severity: "warn",
  description: "Variable references ($input.X, $steps.Y) with no declared source — weak models hallucinate the value.",
  check(ctx) {
    const source = ctx.source;
    const skips = skip(ctx);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];

    // 1. Collect declared inputs from frontmatter/YAML/JSON code blocks.
    const declaredInputs = new Set<string>();
    // `input_schema.properties.foo` or `input:\n  foo:` — match the top-level keys.
    const schemaRe = /input(?:_schema)?:\s*\n((?:\s+\w[^\n]*\n?)+)/g;
    for (const m of source.matchAll(schemaRe)) {
      const body = m[1];
      const keys = body.match(/^\s+(\w+):/gm) ?? [];
      for (const k of keys) {
        declaredInputs.add(k.trim().replace(/:$/, ""));
      }
    }
    // JSON properties: `"properties": { "foo": ... }`
    const jsonPropsRe = /"properties"\s*:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    for (const m of source.matchAll(jsonPropsRe)) {
      const inner = m[1];
      const keys = inner.match(/"(\w+)"\s*:/g) ?? [];
      for (const k of keys) {
        const name = k.match(/"(\w+)"/)![1];
        declaredInputs.add(name);
      }
    }

    // 2. Collect declared step ids from Step headings (e.g. "## Step 1 — …"
    //    → id "1"; "## Step classify — …" → id "classify").
    const declaredSteps = new Set<string>();
    const stepHeadingRe = /^#{1,6}\s+Step\s+([\w-]+)\b/gm;
    for (const m of source.matchAll(stepHeadingRe)) {
      declaredSteps.add(m[1].toLowerCase());
    }
    // Also collect `"id": "foo"` from plan JSON.
    const jsonIdRe = /"id"\s*:\s*"([\w-]+)"/g;
    for (const m of source.matchAll(jsonIdRe)) {
      declaredSteps.add(m[1].toLowerCase());
    }

    // 3. Env vars — harder to declare inline. Only flag when a $env.* ref
    //    has no matching `FOO=` in a fenced block AND no `env:` entry.
    const declaredEnv = new Set<string>();
    const envBlockRe = /env:\s*\n((?:\s+[A-Z_][A-Z0-9_]*[^\n]*\n?)+)/g;
    for (const m of source.matchAll(envBlockRe)) {
      const keys = m[1].match(/^\s+([A-Z_][A-Z0-9_]*)/gm) ?? [];
      for (const k of keys) declaredEnv.add(k.trim());
    }
    const envShellRe = /\b([A-Z_][A-Z0-9_]{2,})=/g;
    for (const m of source.matchAll(envShellRe)) {
      declaredEnv.add(m[1]);
    }

    // If the file declared nothing at all, bail — it's not a structured
    // harness in a shape we can reason about.
    if (declaredInputs.size === 0 && declaredSteps.size === 0) return [];

    // 4. Find references. Match $input.X, $steps.X.output, etc.
    //
    // Intentionally scan the raw source — not via skip spans — because
    // `$input.foo` inside inline code is still a real reference (that's how
    // most harnesses write them), and declarations often live in fenced
    // code blocks. Both get scanned.
    const refRe = /\$(input|steps|env|state)\.([\w.]+)/g;
    void skips; // skip-spans intentionally not applied for this rule
    for (const m of source.matchAll(refRe)) {
      const kind = m[1];
      const path = m[2];
      const topKey = path.split(".")[0];
      let declared: Set<string>;
      if (kind === "input") declared = declaredInputs;
      else if (kind === "steps") declared = declaredSteps;
      else if (kind === "env") declared = declaredEnv;
      else continue; // $state.* — too open-ended to validate cheaply.

      if (declared.size === 0) continue; // nothing to check against for this kind
      const normalized = kind === "steps" ? topKey.toLowerCase() : topKey;
      if (!declared.has(normalized)) {
        matches.push({
          start: m.index!,
          end: m.index! + m[0].length,
          message: `"$${kind}.${path}" has no declared source in this harness. Weak models hallucinate the value.`,
        });
      }
    }
    return findingsFrom(ctx, danglingVariableReference, matches);
  },
};

/** ---- Rule: undefined-step-reference --------------------------------- */

/**
 * Flags in-prose references to `Step N` / `Block X` that don't exist as
 * headings in the same file. Weak models invent the missing step's output
 * rather than admit it isn't there.
 *
 * Only fires in prose — references inside the heading definitions themselves
 * are exempt. Rule is conservative: if the file defines zero steps/blocks,
 * it doesn't fire (the file probably uses a different structure).
 */
export const undefinedStepReference: Rule = {
  id: "undefined-step-reference",
  tier: "deterministic",
  severity: "warn",
  description: "Prose references a Step / Block that doesn't exist in the file.",
  check(ctx) {
    const source = ctx.source;
    const skips = skip(ctx);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];

    // Prefer the cross-file aggregate when the runner provides it — many
    // harnesses split shared Blocks into a sibling file (e.g. _shared.md).
    // Fall back to this-file-only when the runner has no repo context.
    let defined = ctx.repo_headings;
    if (!defined) {
      const local = new Set<string>();
      const headingRe = /^#{1,6}\s+(Step|Block)\s+([A-Z0-9]+)\b/gm;
      for (const m of source.matchAll(headingRe)) {
        local.add(`${m[1].toLowerCase()}:${m[2].toUpperCase()}`);
      }
      defined = local;
    }
    if (defined.size === 0) return [];

    // Find references in prose. Avoid matching heading definitions themselves.
    const refRe = /\b(Step|Block)\s+([A-Z0-9]+)\b/g;
    const lines = source.split("\n");
    const lineStartArr = ctx.line_starts;

    for (const m of scanMatches(source, refRe, skips)) {
      // Skip matches inside heading lines.
      const lineIdx = findLine(lineStartArr, m.index);
      const lineText = lines[lineIdx] ?? "";
      if (/^#{1,6}\s/.test(lineText)) continue;

      const key = `${m[1].toLowerCase()}:${m[2].toUpperCase()}`;
      if (!defined.has(key)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          message: `"${m[0]}" is referenced but not defined in this file or any sibling harness file. Weak models invent the missing content.`,
        });
      }
    }
    return findingsFrom(ctx, undefinedStepReference, matches);
  },
};

/** ---- Rule: missing-file-reference ----------------------------------- */

/**
 * Flags in-prose references to files that don't exist in the repo. Weak
 * models will happily "read" a file that isn't there and fabricate contents.
 *
 * Only runs in harness paths and when the runner passed `repo_files`.
 * Matches bare filenames (cv.md, profile.json) — URLs and absolute paths
 * are ignored. Checks against the whole repo file set because harness files
 * often reference files in sibling directories.
 */
export const missingFileReference: Rule = {
  id: "missing-file-reference",
  tier: "deterministic",
  severity: "warn",
  description: "Prose references a file that doesn't exist in the repo.",
  check(ctx) {
    if (!ctx.repo_files) return [];
    if (!ctx.file.match(/modes\/|prompts\/|skills\/|agents\/|\.cursor\/rules/i)) return [];

    const source = ctx.source;
    const skips = skip(ctx);
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];

    // Match filenames with known harness-adjacent extensions. Exclude URLs
    // (`http://…file.md`) by requiring a non-slash char before the match or
    // a start-of-token boundary.
    const fileRe = /(?<![\w\-./])([\w\-]+\.(?:md|mdc|mdx|json|ya?ml|txt|ts|tsx|js|jsx|py|go|rs|toml))\b/g;

    // Precompute basename index of the repo so we can check "cv.md" against
    // "some/path/cv.md" in one shot.
    const basenames = new Map<string, string[]>();
    for (const path of ctx.repo_files) {
      const slash = path.lastIndexOf("/");
      const base = slash === -1 ? path : path.slice(slash + 1);
      const list = basenames.get(base) ?? [];
      list.push(path);
      basenames.set(base, list);
    }

    for (const m of scanMatches(source, fileRe, skips)) {
      const name = m[1];
      // Allow matches with a directory component via same-directory resolution.
      if (ctx.repo_files.has(name)) continue;
      if (basenames.has(name)) continue;
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${name}" is referenced but not found in the repo. Weak models fabricate contents of missing files.`,
      });
    }
    return findingsFrom(ctx, missingFileReference, matches);
  },
};

/** ---- Rule: context-budget ------------------------------------------- */

/**
 * File-level rule: flag harnesses whose prose word count exceeds a budget.
 * Weak models degrade on long prompts — they lose the middle, ignore
 * later constraints, or truncate outputs.
 *
 * Default budgets: info at 1500 words, warn at 3000. Words are counted
 * after removing code fences and frontmatter (real prose only).
 * Override via config.options:
 *   "context-budget.info_words": 2000
 *   "context-budget.warn_words": 4000
 */
export const contextBudget: Rule = {
  id: "context-budget",
  tier: "deterministic",
  severity: "info",
  description: "File-level prose-length budget — weak models drop the middle of long prompts.",
  check(ctx) {
    // Scope to harness file paths — README/docs aren't harnesses.
    if (!ctx.file.match(/modes\/|prompts\/|skills\/|agents\/|\.cursor\/rules/i)) return [];
    const infoAt = (ctx.config.options["context-budget.info_words"] as number | undefined) ?? 1500;
    const warnAt = (ctx.config.options["context-budget.warn_words"] as number | undefined) ?? 3000;
    // Count only real prose — strip fenced code and frontmatter.
    const source = ctx.source
      .replace(/^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1\r?\n/, "")
      .replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
    const words = source.split(/\s+/).filter(Boolean).length;

    if (words < infoAt) return [];

    const severity: "warn" | "info" = words >= warnAt ? "warn" : "info";
    const threshold = words >= warnAt ? warnAt : infoAt;
    const budget = words >= warnAt ? "warn" : "info";

    // File-level finding: anchor at line 1, column 1.
    return [
      {
        rule_id: contextBudget.id,
        severity,
        file: ctx.file,
        range: { line: 1, column: 1, end_line: 1, end_column: 2 },
        message: `File is ${words} words (${budget} budget ${threshold}). Weak models drop the middle — split into smaller files or trim.`,
        snippet: "",
        llm_fixable: false,
      },
    ];
  },
};

function findLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** ---- Rule: placeholder-leftover ------------------------------------- */

export const placeholderLeftover: Rule = {
  id: "placeholder-leftover",
  tier: "deterministic",
  severity: "warn",
  description: "Catches leftover scaffolding (TODO, FIXME, <insert X>) that weak models echo verbatim.",
  check(ctx) {
    const matches: Array<{ start: number; end: number; message: string; llm_fixable?: boolean }> = [];
    const skips = skip(ctx);

    // 1. Bare keywords (case-sensitive — lowercase "todo" is often prose).
    const keywords = /\b(TODO|FIXME|TBD|XXX|HACK|WIP)\b/g;
    for (const m of scanMatches(ctx.source, keywords, skips)) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" is leftover scaffolding. Weak models echo it verbatim. Remove or complete.`,
      });
    }

    // 2. Angle-bracket placeholders: <insert X>, <placeholder>, <your text here>, <TBD>.
    const angle = /<(insert[^>\n]*|placeholder[^>\n]*|your [^>\n]+|fill in[^>\n]*|TBD|TODO)>/gi;
    for (const m of scanMatches(ctx.source, angle, skips)) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" is a placeholder. Weak models emit it literally. Replace with real content.`,
      });
    }

    // 3. Square-bracket placeholders: [INSERT X], [FILL IN], [YOUR TEXT].
    const square = /\[(INSERT[^\]\n]*|PLACEHOLDER[^\]\n]*|YOUR [^\]\n]+|FILL IN[^\]\n]*|TBD|TODO)\]/g;
    for (const m of scanMatches(ctx.source, square, skips)) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        message: `"${m[0]}" is a placeholder. Weak models emit it literally. Replace with real content.`,
      });
    }

    // 4. Handlebars-style {{var}} — opt-in (many legit templates use these).
    if (ctx.config.options["placeholder-leftover.include_handlebars"]) {
      const hb = /\{\{[^}\n]+\}\}/g;
      for (const m of scanMatches(ctx.source, hb, skips)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          message: `"${m[0]}" looks like an unrendered template variable. Resolve before shipping.`,
        });
      }
    }

    return findingsFrom(ctx, placeholderLeftover, matches);
  },
};

/** ---- helpers -------------------------------------------------------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Full deterministic ruleset, in priority order. */
export const DETERMINISTIC_RULES: Rule[] = [
  softImperative,
  vagueQuantifier,
  tasteWord,
  ambiguousDeictic,
  doubleNegation,
  longSentence,
  pronounNoAntecedent,
  enumWithoutList,
  wordCountTarget,
  implicitConditional,
  trailingEtc,
  headingWithoutImperative,
  nestedConditional,
  multipleOutputFormats,
  placeholderLeftover,
  outputFormatNoExample,
  numberedStepGap,
  stepWithoutVerb,
  undefinedStepReference,
  missingFileReference,
  contextBudget,
  danglingVariableReference,
  invalidJsonFence,
  headingHierarchy,
  staleLinkReference,
  tableColumnMismatch,
  mixedListMarker,
  frontmatterSchema,
];

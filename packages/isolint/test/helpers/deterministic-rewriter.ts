/**
 * A deterministic mock ModelProvider used by fix-pipeline golden tests.
 *
 * Production rewrites go through an LLM, which is non-deterministic and
 * unsuitable for fixture-based regression testing. This mock parses the
 * rewrite prompt to extract the SPAN TO REWRITE + the list of rule ids
 * being violated, then applies canned substitutions per rule. The result
 * is fully deterministic — the same input always produces the same output.
 *
 * This tests the fix PIPELINE (coalescing, validation, retry, ordering) —
 * NOT LLM prompt quality. Prompt changes will leave golden fixtures stable
 * unless they change the SPAN TO REWRITE / rule-id parsing contract.
 */

import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ModelProvider,
} from "../../src/providers/types.js";

export function deterministicRewriter(opts: { debug?: boolean } = {}): ModelProvider {
  return {
    id: "mock:deterministic-rewriter",
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const userMsg: ChatMessage = req.messages[req.messages.length - 1];
      const span = extractSection(userMsg.content, "SPAN TO REWRITE");
      if (!span) return { content: "", model: "mock" };
      const rules = extractRuleIds(userMsg.content);
      if (opts.debug) {
        // eslint-disable-next-line no-console
        console.error("[mock] span:", span.trim().slice(0, 60), "rules:", [...rules]);
      }
      const rewritten = applyCannedFixes(span.trim(), rules);
      return { content: rewritten, model: "mock" };
    },
  };
}

function extractSection(prompt: string, label: string): string | null {
  // Locate the label line. Then walk forward until we hit a blank line
  // followed by an uppercase section header (or end of string).
  const labelRe = new RegExp(`^${label}[^\\n]*\\n`, "m");
  const lm = labelRe.exec(prompt);
  if (!lm) return null;
  const start = lm.index + lm[0].length;
  const rest = prompt.slice(start);
  // Next section boundary: blank line followed by a header that starts with
  // an uppercase letter and ends with a colon.
  const endRe = /\n\n[A-Z][^\n]*:\s*(?:\n|$)/;
  const em = endRe.exec(rest);
  const end = em ? em.index : rest.length;
  return rest.slice(0, end);
}

function extractRuleIds(prompt: string): Set<string> {
  const ids = new Set<string>();
  const block = extractSection(prompt, "RULE VIOLATIONS IN THIS SENTENCE");
  if (!block) return ids;
  for (const m of block.matchAll(/- ([\w-]+):/g)) {
    ids.add(m[1]);
  }
  return ids;
}

export function applyCannedFixes(text: string, rules: Set<string>): string {
  let t = text;
  if (rules.has("soft-imperative")) {
    t = t
      .replace(/\bshould\b/g, "MUST")
      .replace(/\bShould\b/g, "MUST")
      .replace(/\bcould\b/g, "MUST")
      .replace(/\bCould\b/g, "MUST")
      .replace(/\bmight\b/g, "will")
      .replace(/\bconsider\b/g, "")
      .replace(/\bideally\b/g, "");
  }
  if (rules.has("taste-word")) {
    t = t
      .replace(/\b(creative|engaging|passionate|polished|natural|good|nice|great|appropriate)\b/gi, "specific")
      .replace(/\b(leveraged|utilized|spearheaded|cutting-edge|world-class|synergy|holistic)\b/gi, "used");
  }
  if (rules.has("vague-quantifier")) {
    t = t.replace(/\b(some|several|a few|many|most of|a number of|numerous|various)\b/gi, "5");
  }
  if (rules.has("trailing-etc")) {
    t = t.replace(/,\s*(etc\.?|and so on|and such)/gi, "");
  }
  if (rules.has("implicit-conditional")) {
    t = t
      .replace(/\bwhen relevant\b/gi, "when score >= 0.6")
      .replace(/\bas needed\b/gi, "when count > 0")
      .replace(/\bif appropriate\b/gi, "if status = ready");
  }
  if (rules.has("double-negation")) {
    t = t.replace(/don'?t forget to not/gi, "always");
  }
  // Collapse double spaces left by deletions.
  t = t.replace(/  +/g, " ").replace(/ ([.,;:!?])/g, "$1");
  return t.trim();
}

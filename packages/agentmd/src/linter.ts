import type { Diagnostic, Doc, Rule } from "./types.js";
import { extractIdReferences } from "./parser.js";

const FALLBACK_WORDS = ["default", "else", "otherwise", "fallback", "no match", "any other"];

const IMPERATIVE_VERBS = new Set([
  "read", "write", "draft", "emit", "pick", "identify", "check", "use", "return",
  "output", "skip", "split", "revise", "validate", "compute", "parse", "render",
  "run", "send", "fetch", "log", "save", "load", "append", "prepend", "replace",
  "filter", "sort", "copy", "move", "delete", "apply", "compare", "store", "print",
  "call", "invoke", "retry", "abort", "reject", "accept", "select", "generate",
  "extract", "update", "set", "assign", "assert", "confirm", "require", "produce",
  "self-check", "proceed", "stop", "continue", "verify", "mark", "flag", "record",
  "report", "summarize", "summarise", "classify", "format", "normalize", "normalise",
  "ask", "answer", "respond", "reply", "post", "commit", "push",
]);

export function lint(doc: Doc): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // L9: required sections
  if (!doc.agent) {
    diags.push({
      code: "L9",
      severity: "error",
      message: `Missing "# Agent: <name>" heading at the top of the file`,
      line: 1,
    });
  }
  if (!doc.procedure.length) {
    diags.push({
      code: "L9",
      severity: "error",
      message: `Missing "## Procedure" section with at least one step`,
    });
  }
  if (!doc.hardLimits.length && !doc.defaults.length) {
    diags.push({
      code: "L9",
      severity: "warning",
      message: `No rules defined — add a "## Hard limits" or "## Defaults" section`,
    });
  }

  const allRules: Rule[] = [...doc.hardLimits, ...doc.defaults];

  // L1/L2: every rule has ID (parser enforces ID presence by matching regex,
  // so we mainly check why:) — but we still run a guard for empty-id case.
  for (const r of allRules) {
    if (!r.id) {
      diags.push({
        code: "L1",
        severity: "error",
        message: `Rule is missing an [ID]`,
        line: r.line,
      });
    }
    if (!r.why || !r.why.trim()) {
      diags.push({
        code: "L2",
        severity: "error",
        message: `[${r.id}] is missing a "why:" line — state the motivation so the agent can judge edge cases`,
        line: r.line,
      });
    }
  }

  // L3: duplicate IDs
  const idCounts = new Map<string, number>();
  for (const r of allRules) idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) {
      diags.push({
        code: "L3",
        severity: "error",
        message: `Duplicate rule ID [${id}] — each rule must have a unique ID`,
      });
    }
  }

  // L5: ID prefix must match scope section
  for (const r of doc.hardLimits) {
    if (!r.id.startsWith("H")) {
      diags.push({
        code: "L5",
        severity: "warning",
        message: `[${r.id}] appears in Hard limits but the ID doesn't start with "H" — by convention use H1, H2, …`,
        line: r.line,
      });
    }
  }
  for (const r of doc.defaults) {
    if (!r.id.startsWith("D")) {
      diags.push({
        code: "L5",
        severity: "warning",
        message: `[${r.id}] appears in Defaults but the ID doesn't start with "D" — by convention use D1, D2, …`,
        line: r.line,
      });
    }
  }

  // L4: referenced IDs in procedure / routing / description must resolve
  const definedIds = new Set(allRules.map((r) => r.id));
  const ref = (text: string, line?: number) => {
    for (const id of extractIdReferences(text)) {
      if (!definedIds.has(id)) {
        diags.push({
          code: "L4",
          severity: "error",
          message: `Reference to [${id}] but no rule with that ID is defined`,
          line,
        });
      }
    }
  };
  ref(doc.description);
  for (const step of doc.procedure) ref(step.text, step.line);
  for (const row of doc.routing) {
    ref(row.when, row.line);
    ref(row.then, row.line);
  }

  // L6: multi-action procedure steps — fires only when "and"/"or" joins two
  // imperative verbs, not when it connects items in a list of nouns. The
  // previous heuristic ("any and/or anywhere") produced false positives on
  // prose like "identify role, seniority, and priorities".
  for (const step of doc.procedure) {
    const re = /[,;]?\s+(and|or)\s+([a-z][a-z-]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(step.text)) !== null) {
      if (IMPERATIVE_VERBS.has(m[2].toLowerCase())) {
        diags.push({
          code: "L6",
          severity: "warning",
          message: `Step ${step.index} joins two actions ("${m[1]} ${m[2]}…") — split into separate steps so the agent can track completion`,
          line: step.line,
        });
        break;
      }
    }
  }

  // L7: overlong steps
  for (const step of doc.procedure) {
    const words = step.text.split(/\s+/).filter(Boolean).length;
    if (words > 15) {
      diags.push({
        code: "L7",
        severity: "warning",
        message: `Step ${step.index} is ${words} words — aim for ≤12 for small-model reliability`,
        line: step.line,
      });
    }
  }

  // L8: routing should have a fallback row
  if (doc.routing.length > 0) {
    const hasFallback = doc.routing.some((r) =>
      FALLBACK_WORDS.some((w) => r.when.toLowerCase().includes(w)),
    );
    if (!hasFallback) {
      diags.push({
        code: "L8",
        severity: "warning",
        message: `Routing table has no fallback row ("default"/"else"/"otherwise") — the agent has no declared behavior when no row matches`,
      });
    }
  }

  // L10: rules defined but never referenced in procedure or routing prose.
  // The "why:" itself isn't scanned — a rule pointing only at its own
  // rationale is still an orphan from the agent's perspective.
  const referencedIds = new Set<string>();
  for (const step of doc.procedure) {
    for (const id of extractIdReferences(step.text)) referencedIds.add(id);
  }
  for (const row of doc.routing) {
    for (const id of extractIdReferences(row.when)) referencedIds.add(id);
    for (const id of extractIdReferences(row.then)) referencedIds.add(id);
  }
  for (const id of extractIdReferences(doc.description)) referencedIds.add(id);
  for (const r of allRules) {
    if (!referencedIds.has(r.id)) {
      diags.push({
        code: "L10",
        severity: "warning",
        message: `[${r.id}] is defined but never referenced in the Procedure or Routing — wire it into a step or drop it`,
        line: r.line,
      });
    }
  }

  // L11: rationale thinner than ~5 words can't actually guide edge-case
  // judgement. A one- or two-word why: defeats the design.
  for (const r of allRules) {
    if (!r.why) continue;
    const words = r.why.trim().split(/\s+/).filter(Boolean).length;
    if (words > 0 && words < 5) {
      diags.push({
        code: "L11",
        severity: "warning",
        message: `[${r.id}] why: is only ${words} word${words === 1 ? "" : "s"} — state a concrete motivation the model can use to judge edge cases`,
        line: r.line,
      });
    }
  }

  return diags;
}

export function formatDiagnostic(d: Diagnostic, file?: string): string {
  const loc = file ? `${file}${d.line ? `:${d.line}` : ""}` : d.line ? `line ${d.line}` : "";
  const prefix = loc ? `${loc}: ` : "";
  return `${prefix}${d.severity} ${d.code}: ${d.message}`;
}

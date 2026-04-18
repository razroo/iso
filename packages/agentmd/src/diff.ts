import type { Doc, Rule } from "./types.js";

export interface PromptDiff {
  added: Rule[];
  removed: Rule[];
  scopeChanged: { id: string; from: Rule["scope"]; to: Rule["scope"] }[];
  claimChanged: { id: string; from: string; to: string }[];
  whyChanged: { id: string; from: string | null; to: string | null }[];
  procedureDelta: number;
  routingDelta: number;
}

function ruleMap(doc: Doc): Map<string, Rule> {
  const m = new Map<string, Rule>();
  for (const r of doc.hardLimits) m.set(r.id, r);
  for (const r of doc.defaults) m.set(r.id, r);
  return m;
}

export function diffPrompts(oldDoc: Doc, newDoc: Doc): PromptDiff {
  const before = ruleMap(oldDoc);
  const after = ruleMap(newDoc);
  const added: Rule[] = [];
  const removed: Rule[] = [];
  const scopeChanged: PromptDiff["scopeChanged"] = [];
  const claimChanged: PromptDiff["claimChanged"] = [];
  const whyChanged: PromptDiff["whyChanged"] = [];

  for (const [id, r] of after) {
    if (!before.has(id)) added.push(r);
  }
  for (const [id, r] of before) {
    if (!after.has(id)) removed.push(r);
  }
  for (const [id, oldRule] of before) {
    const newRule = after.get(id);
    if (!newRule) continue;
    if (oldRule.scope !== newRule.scope) {
      scopeChanged.push({ id, from: oldRule.scope, to: newRule.scope });
    }
    if (oldRule.claim !== newRule.claim) {
      claimChanged.push({ id, from: oldRule.claim, to: newRule.claim });
    }
    if ((oldRule.why ?? null) !== (newRule.why ?? null)) {
      whyChanged.push({ id, from: oldRule.why, to: newRule.why });
    }
  }

  return {
    added,
    removed,
    scopeChanged,
    claimChanged,
    whyChanged,
    procedureDelta: newDoc.procedure.length - oldDoc.procedure.length,
    routingDelta: newDoc.routing.length - oldDoc.routing.length,
  };
}

function scopeLabel(scope: Rule["scope"]): string {
  return scope === "hard" ? "hard" : "default";
}

export function formatDiff(oldAgent: string, newAgent: string, d: PromptDiff): string {
  const out: string[] = [];
  out.push(`${oldAgent}  \u2192  ${newAgent}`);
  out.push("");

  if (d.added.length) {
    out.push(`added (${d.added.length}):`);
    for (const r of d.added) out.push(`  + [${r.id}] (${scopeLabel(r.scope)}) ${r.claim}`);
    out.push("");
  }
  if (d.removed.length) {
    out.push(`removed (${d.removed.length}):`);
    for (const r of d.removed) out.push(`  - [${r.id}] (${scopeLabel(r.scope)}) ${r.claim}`);
    out.push("");
  }
  if (d.scopeChanged.length) {
    out.push(`scope changed (${d.scopeChanged.length}):`);
    for (const s of d.scopeChanged)
      out.push(`  * [${s.id}] ${scopeLabel(s.from)} \u2192 ${scopeLabel(s.to)}`);
    out.push("");
  }
  if (d.claimChanged.length) {
    out.push(`claim changed (${d.claimChanged.length}):`);
    for (const c of d.claimChanged) {
      out.push(`  * [${c.id}]`);
      out.push(`      - ${c.from}`);
      out.push(`      + ${c.to}`);
    }
    out.push("");
  }
  if (d.whyChanged.length) {
    out.push(`why changed (${d.whyChanged.length}):`);
    for (const w of d.whyChanged) {
      out.push(`  * [${w.id}]`);
      out.push(`      - why: ${w.from ?? "(none)"}`);
      out.push(`      + why: ${w.to ?? "(none)"}`);
    }
    out.push("");
  }

  const procSign = d.procedureDelta > 0 ? "+" : "";
  const routeSign = d.routingDelta > 0 ? "+" : "";
  out.push(`procedure steps: ${procSign}${d.procedureDelta}`);
  out.push(`routing rows:    ${routeSign}${d.routingDelta}`);

  const nothing =
    !d.added.length &&
    !d.removed.length &&
    !d.scopeChanged.length &&
    !d.claimChanged.length &&
    !d.whyChanged.length &&
    d.procedureDelta === 0 &&
    d.routingDelta === 0;
  if (nothing) {
    return `${oldAgent}  \u2192  ${newAgent}\n\nno structural changes\n`;
  }
  return out.join("\n") + "\n";
}

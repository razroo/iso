import type { Doc } from "./types.js";

export function render(doc: Doc): string {
  const out: string[] = [];
  out.push(`# Agent: ${doc.agent}`);
  out.push("");
  if (doc.description) {
    out.push(doc.description);
    out.push("");
  }

  if (doc.hardLimits.length) {
    out.push("## Hard limits — must never be violated");
    out.push("");
    for (const r of doc.hardLimits) {
      out.push(`- [${r.id}] ${r.claim}`);
      if (r.why) out.push(`  why: ${r.why}`);
    }
    out.push("");
  }

  if (doc.defaults.length) {
    out.push("## Defaults — may be overridden only with an explicit stated reason");
    out.push("");
    for (const r of doc.defaults) {
      out.push(`- [${r.id}] ${r.claim}`);
      if (r.why) out.push(`  why: ${r.why}`);
    }
    out.push("");
  }

  if (doc.procedure.length) {
    out.push("## Procedure");
    out.push("");
    for (const step of doc.procedure) {
      out.push(`${step.index}. ${step.text}`);
    }
    out.push("");
  }

  if (doc.routing.length) {
    out.push("## Routing");
    out.push("");
    out.push("| When | Do |");
    out.push("|------|-----|");
    for (const row of doc.routing) {
      out.push(`| ${row.when} | ${row.then} |`);
    }
    out.push("");
  }

  for (const ctx of doc.context) {
    out.push(`## ${ctx.heading}`);
    out.push("");
    if (ctx.body) {
      out.push(ctx.body);
      out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

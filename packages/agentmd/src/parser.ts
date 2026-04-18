import type { Doc, Rule, ProcedureStep, RoutingRow, Scope, Diagnostic } from "./types.js";

const AGENT_HEADING = /^#\s+Agent:\s*(.+?)\s*$/;
const H1_ANY = /^#\s+.+/;
const H2 = /^##\s+(.+?)\s*$/;
const RULE_LINE = /^-\s+\[([A-Za-z]+\d+)\]\s+(.+?)\s*$/;
const WHY_LINE = /^\s+why:\s*(.+?)\s*$/;
const NUMBERED_STEP = /^(\d+)\.\s+(.+?)\s*$/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_SEP = /^\|[\s:\-|]+\|\s*$/;

type SectionKind = "hard" | "default" | "procedure" | "routing" | "context" | "none";

function classifyHeading(heading: string): SectionKind {
  const h = heading.toLowerCase().trim();
  if (h === "hard limits" || h === "hard-limits") return "hard";
  if (h === "defaults") return "default";
  if (h === "procedure") return "procedure";
  if (h === "routing") return "routing";
  return "context";
}

function scopeFromId(id: string): Scope | null {
  if (id.startsWith("H")) return "hard";
  if (id.startsWith("D")) return "default";
  return null;
}

export function parse(source: string, sourcePath?: string): Doc {
  // Strip UTF-8 BOM and normalize CRLF / bare CR so the parser sees a
  // uniform stream regardless of editor/OS origin.
  const normalized = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const parseDiagnostics: Diagnostic[] = [];
  const doc: Doc = {
    agent: "",
    description: "",
    hardLimits: [],
    defaults: [],
    procedure: [],
    routing: [],
    context: [],
    sourcePath,
    parseDiagnostics,
  };

  let i = 0;
  const descLines: string[] = [];
  let currentSection: SectionKind = "none";
  let currentHeading = "";
  let contextBuf: string[] = [];
  let routingSawSeparator = false;
  let routingFirstRow = true;

  const flushContext = () => {
    if (currentSection === "context" && currentHeading) {
      doc.context.push({
        heading: currentHeading,
        body: contextBuf.join("\n").trim(),
      });
    }
    contextBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 1;

    const agentMatch = line.match(AGENT_HEADING);
    if (agentMatch) {
      if (!doc.agent) {
        doc.agent = agentMatch[1].trim();
      } else {
        parseDiagnostics.push({
          code: "L12",
          severity: "warning",
          message: `Duplicate "# Agent:" heading — only the first one defines the agent name; the rest are ignored`,
          line: lineNo,
        });
      }
      i++;
      continue;
    }

    const h2Match = line.match(H2);
    if (h2Match) {
      flushContext();
      currentHeading = h2Match[1].trim();
      currentSection = classifyHeading(currentHeading);
      if (currentSection === "routing") {
        routingSawSeparator = false;
        routingFirstRow = true;
      }
      i++;
      continue;
    }

    if (currentSection === "none") {
      // Pre-section content after the H1 becomes the description.
      if (line.trim() || descLines.length) descLines.push(line);
      i++;
      continue;
    }

    if (currentSection === "hard" || currentSection === "default") {
      const ruleMatch = line.match(RULE_LINE);
      if (ruleMatch) {
        const id = ruleMatch[1];
        const claimParts: string[] = [ruleMatch[2].trim()];
        let why: string | null = null;
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          if (!next.trim()) break;
          if (next.match(RULE_LINE)) break;
          const whyMatch = next.match(WHY_LINE);
          if (whyMatch) {
            why = whyMatch[1].trim();
            j++;
            break;
          }
          if (/^\s+/.test(next)) {
            claimParts.push(next.trim());
            j++;
            continue;
          }
          break;
        }
        const declaredScope = scopeFromId(id);
        const scope: Scope = currentSection === "hard" ? "hard" : "default";
        const rule: Rule = {
          id,
          scope: declaredScope ?? scope,
          claim: claimParts.join(" "),
          why,
          line: lineNo,
        };
        if (scope === "hard") doc.hardLimits.push(rule);
        else doc.defaults.push(rule);
        i = j;
        continue;
      }
      i++;
      continue;
    }

    if (currentSection === "procedure") {
      const stepMatch = line.match(NUMBERED_STEP);
      if (stepMatch) {
        doc.procedure.push({
          index: Number(stepMatch[1]),
          text: stepMatch[2].trim(),
          line: lineNo,
        });
      }
      i++;
      continue;
    }

    if (currentSection === "routing") {
      if (line.match(TABLE_SEP)) {
        routingSawSeparator = true;
        routingFirstRow = false;
        i++;
        continue;
      }
      const rowMatch = line.match(TABLE_ROW);
      if (rowMatch) {
        const cells = rowMatch[1].split("|").map((c) => c.trim());
        if (cells.length >= 2) {
          // Standard markdown pipe tables: the row before the |---| separator
          // is the header. Peek ahead: if the next non-empty line is a
          // separator, this row is the header — skip it regardless of its
          // text.
          if (routingFirstRow && !routingSawSeparator) {
            let k = i + 1;
            while (k < lines.length && !lines[k].trim()) k++;
            if (k < lines.length && lines[k].match(TABLE_SEP)) {
              routingFirstRow = false;
              i++;
              continue;
            }
          }
          routingFirstRow = false;
          doc.routing.push({
            when: cells[0],
            then: cells[1],
            line: lineNo,
          });
        }
      }
      i++;
      continue;
    }

    if (currentSection === "context") {
      contextBuf.push(line);
      i++;
      continue;
    }
  }

  flushContext();
  doc.description = descLines.join("\n").trim();
  return doc;
}

export function extractIdReferences(text: string): string[] {
  const refs: string[] = [];
  const re = /\[([A-Za-z]+\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) refs.push(m[1]);
  return refs;
}

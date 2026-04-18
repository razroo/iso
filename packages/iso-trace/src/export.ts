import type { Session } from "./types.js";
import { iterateEvents } from "./query.js";

export type ExportFormat = "json" | "jsonl";

export function exportSession(session: Session, format: ExportFormat = "json"): string {
  if (format === "json") return JSON.stringify(session, null, 2);
  if (format === "jsonl") {
    const lines: string[] = [];
    lines.push(JSON.stringify({ type: "session", ...sessionHeader(session) }));
    for (const { event, turnIndex, role, at } of iterateEvents(session)) {
      lines.push(JSON.stringify({ type: "event", turnIndex, role, at, ...event }));
    }
    return lines.join("\n") + "\n";
  }
  const exhaustive: never = format;
  throw new Error(`iso-trace: unknown export format "${String(exhaustive)}"`);
}

function sessionHeader(session: Session) {
  const { turns: _turns, ...rest } = session;
  return rest;
}

import type { Event, FileOpEvent, Session, ToolCallEvent } from "./types.js";

export type EventPredicate = (evt: Event, ctx: { turnIndex: number; role: string; at: string }) => boolean;

export function* iterateEvents(
  session: Session,
): Generator<{ event: Event; turnIndex: number; role: string; at: string }> {
  for (const turn of session.turns) {
    for (const event of turn.events) {
      yield { event, turnIndex: turn.index, role: turn.role, at: turn.at };
    }
  }
}

export function filter(session: Session, predicate: EventPredicate): Event[] {
  const out: Event[] = [];
  for (const { event, turnIndex, role, at } of iterateEvents(session)) {
    if (predicate(event, { turnIndex, role, at })) out.push(event);
  }
  return out;
}

export interface StatsOptions {
  groupBy?: "tool" | "file_op" | "turn_role";
}

export interface Stats {
  sessions: number;
  turns: number;
  durationMs: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreated: number };
  toolCalls: Record<string, number>;
  fileOps: Record<string, number>;
  filesTouched: { read: string[]; written: string[]; edited: string[] };
}

export function stats(sessions: Session[]): Stats {
  const result: Stats = {
    sessions: sessions.length,
    turns: 0,
    durationMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreated: 0 },
    toolCalls: {},
    fileOps: {},
    filesTouched: { read: [], written: [], edited: [] },
  };
  const read = new Set<string>();
  const written = new Set<string>();
  const edited = new Set<string>();

  for (const s of sessions) {
    result.turns += s.turns.length;
    result.durationMs += s.durationMs;
    result.tokens.input += s.tokenUsage.input;
    result.tokens.output += s.tokenUsage.output;
    result.tokens.cacheRead += s.tokenUsage.cacheRead;
    result.tokens.cacheCreated += s.tokenUsage.cacheCreated;
    for (const { event } of iterateEvents(s)) {
      if (event.kind === "tool_call") {
        const e = event as ToolCallEvent;
        result.toolCalls[e.name] = (result.toolCalls[e.name] ?? 0) + 1;
      } else if (event.kind === "file_op") {
        const e = event as FileOpEvent;
        result.fileOps[e.op] = (result.fileOps[e.op] ?? 0) + 1;
        if (e.op === "read") read.add(e.path);
        else if (e.op === "write") written.add(e.path);
        else if (e.op === "edit") edited.add(e.path);
      }
    }
  }
  result.filesTouched.read = [...read].sort();
  result.filesTouched.written = [...written].sort();
  result.filesTouched.edited = [...edited].sort();
  return result;
}

export function findSessionById(refs: { id: string }[], idOrPrefix: string): { id: string } | undefined {
  const exact = refs.find((r) => r.id === idOrPrefix);
  if (exact) return exact;
  const matches = refs.filter((r) => r.id.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `iso-trace: id prefix "${idOrPrefix}" matches ${matches.length} sessions — use more characters`,
    );
  }
  return undefined;
}

import type { FileOpKind, Session } from "./types.js";

export interface InspectOptions {
  previewChars?: number;
}

export interface SessionInspection {
  id: string;
  source: Session["source"];
  cwd: string;
  title?: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  turnCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  toolErrorCount: number;
  tokenUsageEventCount: number;
  toolNames: string[];
  fileOps: Record<FileOpKind, number>;
  filesTouched: {
    read: string[];
    written: string[];
    edited: string[];
  };
  preview: {
    firstUser?: string;
    lastAssistant?: string;
  };
}

export function inspectSession(session: Session, options: InspectOptions = {}): SessionInspection {
  const previewChars = Math.max(24, options.previewChars ?? 160);
  const read = new Set<string>();
  const written = new Set<string>();
  const edited = new Set<string>();
  const toolNames = new Set<string>();
  const fileOps: Record<FileOpKind, number> = {
    read: 0,
    write: 0,
    edit: 0,
    list: 0,
    search: 0,
  };

  let messageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  let toolErrorCount = 0;
  let tokenUsageEventCount = 0;
  let firstUser: string | undefined;
  let lastAssistant: string | undefined;

  for (const turn of session.turns) {
    for (const event of turn.events) {
      switch (event.kind) {
        case "message": {
          messageCount += 1;
          const preview = compactPreview(event.text, previewChars);
          if (event.role === "user") {
            userMessageCount += 1;
            if (!firstUser && preview) firstUser = preview;
          } else if (event.role === "assistant") {
            assistantMessageCount += 1;
            if (preview) lastAssistant = preview;
          }
          break;
        }
        case "tool_call":
          toolCallCount += 1;
          if (event.name) toolNames.add(event.name);
          break;
        case "tool_result":
          toolResultCount += 1;
          if (event.error) toolErrorCount += 1;
          break;
        case "token_usage":
          tokenUsageEventCount += 1;
          break;
        case "file_op":
          fileOps[event.op] += 1;
          if (event.op === "read") read.add(event.path);
          else if (event.op === "write") written.add(event.path);
          else if (event.op === "edit") edited.add(event.path);
          break;
      }
    }
  }

  return {
    id: session.id,
    source: session.source,
    cwd: session.cwd,
    title: session.title,
    model: session.model,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    turnCount: session.turns.length,
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    toolResultCount,
    toolErrorCount,
    tokenUsageEventCount,
    toolNames: [...toolNames].sort(),
    fileOps,
    filesTouched: {
      read: [...read].sort(),
      written: [...written].sort(),
      edited: [...edited].sort(),
    },
    preview: {
      ...(firstUser ? { firstUser } : {}),
      ...(lastAssistant ? { lastAssistant } : {}),
    },
  };
}

export function inspectSessions(sessions: Session[], options: InspectOptions = {}): SessionInspection[] {
  return sessions.map((session) => inspectSession(session, options));
}

function compactPreview(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

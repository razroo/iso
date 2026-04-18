export type HarnessName = "claude-code" | "codex" | "opencode";

export interface SourceInfo {
  harness: HarnessName;
  format: string;
  path: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreated: number;
}

export interface MessageEvent {
  kind: "message";
  role: "user" | "assistant" | "system";
  text: string;
}

export interface ToolCallEvent {
  kind: "tool_call";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultEvent {
  kind: "tool_result";
  toolUseId: string;
  output: string;
  truncated?: boolean;
  error?: string;
}

export type FileOpKind = "read" | "write" | "edit" | "list" | "search";

export interface FileOpEvent {
  kind: "file_op";
  op: FileOpKind;
  path: string;
  tool: string;
  bytesChanged?: number;
}

export interface TokenUsageEvent {
  kind: "token_usage";
  input: number;
  output: number;
  cacheRead: number;
  cacheCreated: number;
  model?: string;
}

export type Event =
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | FileOpEvent
  | TokenUsageEvent;

export interface Turn {
  index: number;
  role: "user" | "assistant" | "system" | "tool";
  at: string;
  events: Event[];
}

export interface Session {
  id: string;
  source: SourceInfo;
  cwd: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  turns: Turn[];
  tokenUsage: TokenUsage;
}

export interface SessionRef {
  id: string;
  source: SourceInfo;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  turnCount: number;
  sizeBytes: number;
}

export interface DiscoverOptions {
  harness?: HarnessName;
  cwd?: string;
  since?: string;
  roots?: string[];
}

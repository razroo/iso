import type { HarnessName, Session, SessionRef } from "../types.js";
import { parseClaudeCode, refForClaudeCode } from "./claude-code.js";

export function loadSessionFromPath(path: string, harness: HarnessName = "claude-code"): Session {
  switch (harness) {
    case "claude-code":
      return parseClaudeCode(path);
    case "codex":
    case "opencode":
      throw new Error(
        `iso-trace: ${harness} parser is not implemented in v0.1. Only claude-code is supported today.`,
      );
    default: {
      const exhaustive: never = harness;
      throw new Error(`iso-trace: unknown harness "${String(exhaustive)}"`);
    }
  }
}

export function refFromPath(path: string, harness: HarnessName = "claude-code"): SessionRef {
  switch (harness) {
    case "claude-code":
      return refForClaudeCode(path);
    case "codex":
    case "opencode":
      throw new Error(
        `iso-trace: ${harness} parser is not implemented in v0.1. Only claude-code is supported today.`,
      );
    default: {
      const exhaustive: never = harness;
      throw new Error(`iso-trace: unknown harness "${String(exhaustive)}"`);
    }
  }
}

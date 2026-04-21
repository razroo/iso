import { existsSync, readFileSync } from "node:fs";
import type { HarnessName, Session, SessionRef } from "../types.js";
import { parseClaudeCode, refForClaudeCode } from "./claude-code.js";
import { parseCodex, refForCodex } from "./codex.js";
import { looksLikeOpenCodeExport, parseOpenCode, refForOpenCode } from "./opencode.js";

export function loadSessionFromPath(path: string, harness?: HarnessName): Session {
  switch (harness ?? inferHarnessFromPath(path)) {
    case "claude-code":
      return parseClaudeCode(path);
    case "codex":
      return parseCodex(path);
    case "opencode":
      return parseOpenCode(path);
    default:
      throw new Error(`iso-trace: could not infer harness for "${path}"`);
  }
}

export function refFromPath(path: string, harness?: HarnessName): SessionRef {
  switch (harness ?? inferHarnessFromPath(path)) {
    case "claude-code":
      return refForClaudeCode(path);
    case "codex":
      return refForCodex(path);
    case "opencode":
      return refForOpenCode(path);
    default:
      throw new Error(`iso-trace: could not infer harness for "${path}"`);
  }
}

function inferHarnessFromPath(path: string): HarnessName | undefined {
  const norm = path.replace(/\\/g, "/");
  if (/#session=/.test(path) || /(?:^|\/)opencode\.db(?:#|$)/.test(norm)) return "opencode";
  if (norm.includes("/.claude/")) return "claude-code";
  if (norm.includes("/.codex/")) return "codex";
  if (!existsSync(path)) return undefined;

  const raw = readFileSync(path, "utf8");
  if (looksLikeOpenCodeExport(raw)) return "opencode";

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0];
  if (!firstLine) return undefined;
  if (firstLine.startsWith("Exporting session:")) return "opencode";

  // Claude Code transcripts can begin with metadata records like
  // `permission-mode` before the first user/assistant message, so we scan
  // a small prefix of JSONL records rather than assuming record 1 carries
  // the harness signature.
  for (const line of lines.slice(0, 10)) {
    try {
      const rec = JSON.parse(line) as { type?: unknown; message?: unknown };
      if (
        rec.type === "session_meta" ||
        rec.type === "response_item" ||
        rec.type === "turn_context" ||
        rec.type === "event_msg"
      ) {
        return "codex";
      }
      if (
        rec.message !== undefined ||
        rec.type === "user" ||
        rec.type === "assistant" ||
        rec.type === "system" ||
        rec.type === "permission-mode"
      ) {
        return "claude-code";
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

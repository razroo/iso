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

  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return undefined;
  if (firstLine.startsWith("Exporting session:")) return "opencode";

  try {
    const first = JSON.parse(firstLine) as { type?: unknown; message?: unknown };
    if (
      first.type === "session_meta" ||
      first.type === "response_item" ||
      first.type === "turn_context" ||
      first.type === "event_msg"
    ) {
      return "codex";
    }
    if (
      first.message !== undefined ||
      first.type === "user" ||
      first.type === "assistant" ||
      first.type === "system"
    ) {
      return "claude-code";
    }
  } catch {
    return undefined;
  }

  return undefined;
}

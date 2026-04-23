import { homedir } from "node:os";
import type { Session } from "./types.js";

export interface RedactionOptions {
  patterns?: RegExp[];
  redactPaths?: boolean;
  redactSecrets?: boolean;
}

export interface Redactor {
  text(value: string): string;
  value<T>(value: T): T;
}

export function createRedactor(session: Session, opts: RedactionOptions = {}): Redactor {
  const cwd = session.cwd;
  const sourcePath = session.source.path;
  const home = homedir();
  const redactPaths = opts.redactPaths ?? true;
  const redactSecrets = opts.redactSecrets ?? true;
  const customPatterns = opts.patterns ?? [];

  return {
    text(value: string): string {
      let out = value;

      if (redactPaths) {
        if (sourcePath) out = replaceAllLiteral(out, sourcePath, "<SOURCE_PATH>");
        if (cwd) {
          out = replaceAllLiteral(out, `${cwd}/`, "./");
          if (out === cwd) out = "<CWD>";
        }
        if (home) {
          out = replaceAllLiteral(out, `${home}/`, "~/");
          if (out === home) out = "~";
        }
      }

      if (redactSecrets) {
        for (const { pattern, replacement } of SECRET_PATTERNS) {
          out = out.replace(pattern, replacement);
        }
      }

      for (const pattern of customPatterns) {
        out = out.replace(pattern, "<REDACTED>");
      }
      return out;
    },

    value<T>(value: T): T {
      return redactValue(value, this.text) as T;
    },
  };
}

export function redactSession(session: Session, opts: RedactionOptions = {}): Session {
  return createRedactor(session, opts).value(session);
}

const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: "<SECRET:OPENAI_KEY>" },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: "<SECRET:GITHUB_TOKEN>" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: "<SECRET:GITHUB_TOKEN>" },
  { pattern: /\bAIza[0-9A-Za-z\-_]{20,}\b/g, replacement: "<SECRET:GOOGLE_KEY>" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<SECRET:AWS_KEY>" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "<SECRET:SLACK_TOKEN>" },
  { pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/g, replacement: "Bearer <SECRET>" },
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "<SECRET:PRIVATE_KEY>",
  },
];

function redactValue(value: unknown, redactText: (value: string) => string): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactText));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = redactValue(child, redactText);
  }
  return out;
}

function replaceAllLiteral(value: string, literal: string, replacement: string): string {
  if (!literal) return value;
  return value.split(literal).join(replacement);
}

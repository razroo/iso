import type { RedactSeverity } from "./types.js";

export interface BuiltinPatternDefinition {
  id: string;
  label: string;
  pattern: string;
  flags: string;
  severity: RedactSeverity;
  replacement?: string;
}

export const BUILTIN_PATTERNS: Record<string, BuiltinPatternDefinition> = {
  email: {
    id: "email",
    label: "Email address",
    pattern: "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b",
    flags: "gi",
    severity: "warn",
  },
  phone: {
    id: "phone",
    label: "Phone number",
    pattern: "(?<!\\d)(?:\\+?1[\\s.-]?)?(?:\\(?\\d{3}\\)?[\\s.-]?)\\d{3}[\\s.-]?\\d{4}(?!\\d)",
    flags: "g",
    severity: "warn",
  },
  "openai-api-key": {
    id: "openai-api-key",
    label: "OpenAI API key",
    pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",
    flags: "g",
    severity: "error",
  },
  "github-token": {
    id: "github-token",
    label: "GitHub token",
    pattern: "\\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\\b",
    flags: "g",
    severity: "error",
  },
  "npm-token": {
    id: "npm-token",
    label: "npm token",
    pattern: "\\bnpm_[A-Za-z0-9]{20,}\\b",
    flags: "g",
    severity: "error",
  },
  "aws-access-key-id": {
    id: "aws-access-key-id",
    label: "AWS access key id",
    pattern: "\\b(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\\b",
    flags: "g",
    severity: "error",
  },
  "bearer-token": {
    id: "bearer-token",
    label: "Bearer token",
    pattern: "\\bBearer\\s+[A-Za-z0-9._~+/=-]{20,}\\b",
    flags: "g",
    severity: "error",
  },
  "private-key": {
    id: "private-key",
    label: "Private key block",
    pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    flags: "g",
    severity: "error",
  },
  "proxy-url-credentials": {
    id: "proxy-url-credentials",
    label: "Proxy URL credentials",
    pattern: "\\b[a-z][a-z0-9+.-]*://[^\\s/@:]+:[^\\s/@]+@[^\\s]+",
    flags: "gi",
    severity: "error",
  },
};

export const DEFAULT_BUILTINS = [
  "email",
  "phone",
  "openai-api-key",
  "github-token",
  "npm-token",
  "aws-access-key-id",
  "bearer-token",
  "private-key",
  "proxy-url-credentials",
];

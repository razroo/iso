import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CustomRuleSpec, ResolvedConfig, Severity } from "./types.js";

export interface RawConfig {
  extends?: string[];
  rules?: Record<string, Severity | "off">;
  ignore?: string[];
  options?: Record<string, unknown>;
  skip_spans?: Partial<ResolvedConfig["skip_spans"]>;
  custom_rules?: CustomRuleSpec[];
  section_severity?: Record<string, Severity | "off">;
}

export const DEFAULT_IGNORE = [
  "node_modules/**",
  "dist/**",
  ".git/**",
  "build/**",
  "out/**",
  "coverage/**",
  ".cache/**",
  ".next/**",
  ".turbo/**",
  "vendor/**",
  "*.min.md",
];

export const DEFAULT_CONFIG: ResolvedConfig = {
  rules: {},
  ignore: [...DEFAULT_IGNORE],
  options: {},
  extends: ["recommended", "performance"],
  custom_rules: [],
  section_severity: {},
  skip_spans: {
    fenced_code: true,
    inline_code: true,
    html_comments: true,
    quoted_strings: true,
    quoted_strings_max_chars: 40,
    frontmatter: true,
    blockquotes: true,
  },
};

export function loadConfig(cwd: string, explicitPath?: string): ResolvedConfig {
  const candidates = explicitPath
    ? [resolve(cwd, explicitPath)]
    : configCandidates(cwd);
  for (const path of candidates) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as RawConfig;
      return mergeConfig(DEFAULT_CONFIG, raw);
    } catch {
      continue;
    }
  }
  return { ...DEFAULT_CONFIG };
}

function configCandidates(startDir: string): string[] {
  const out: string[] = [];
  let dir = resolve(startDir);
  while (true) {
    out.push(resolve(dir, ".isolint.json"));
    out.push(resolve(dir, ".isomodel-lint.json"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

export function mergeConfig(base: ResolvedConfig, raw: RawConfig): ResolvedConfig {
  return {
    extends: raw.extends ?? base.extends,
    rules: { ...base.rules, ...(raw.rules ?? {}) },
    ignore: [...base.ignore, ...(raw.ignore ?? [])],
    options: { ...base.options, ...(raw.options ?? {}) },
    custom_rules: [...base.custom_rules, ...(raw.custom_rules ?? [])],
    section_severity: { ...base.section_severity, ...(raw.section_severity ?? {}) },
    skip_spans: { ...base.skip_spans, ...(raw.skip_spans ?? {}) },
  };
}

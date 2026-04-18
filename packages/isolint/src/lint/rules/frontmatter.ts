/**
 * Harness-format-aware frontmatter rules
 * --------------------------------------
 * Different harness systems have mandatory frontmatter fields. A Claude
 * Code agent with no `description` can't self-describe; a Cursor rule
 * with neither `globs` nor `alwaysApply` never activates.
 *
 * We detect format from file path, parse a small subset of YAML (enough
 * for `key: value` and `key: [a, b]`), and flag missing/malformed fields.
 *
 * Tiny YAML parser intentionally — a full library adds weight and most
 * harness frontmatter is shallow.
 */

import type { LintFinding, Rule } from "../types.js";
import { rangeFromOffsets } from "../source.js";

interface FrontmatterSchema {
  id: string;
  name: string;
  pathPattern: RegExp;
  required: string[];
  /** At-least-one: the file must have any of these keys. */
  anyOf?: string[][];
  arrayKeys?: string[];
}

const SCHEMAS: FrontmatterSchema[] = [
  {
    id: "claude-code-agent",
    name: "Claude Code agent",
    pathPattern: /(?:^|\/)\.claude\/agents\/[^/]+\.md$/,
    required: ["description"],
  },
  {
    id: "cursor-rule",
    name: "Cursor .mdc rule",
    pathPattern: /(?:^|\/)\.cursor\/rules\/[^/]+\.mdc$/,
    required: ["description"],
    anyOf: [["globs", "alwaysApply"]],
  },
  {
    id: "opencode-mode",
    name: "Opencode mode",
    pathPattern: /(?:^|\/)modes\/[^/_][^/]*\.md$/,
    required: [],
    arrayKeys: ["tools"],
  },
];

interface Parsed {
  start: number;
  end: number;
  keys: Record<string, { value: string; line: number; col: number; isArray: boolean }>;
}

function parseFrontmatter(source: string): Parsed | null {
  // Accept frontmatter whose closing fence is followed by a newline OR
  // immediately end-of-file (e.g. the whole file is just frontmatter).
  const m = /^(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/.exec(source);
  if (!m || m.index !== 0) return null;
  const body = m[2];
  const bodyStart = m[1].length + 1;
  const keys: Parsed["keys"] = {};
  const lines = body.split("\n");
  let offset = bodyStart;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(line);
    if (top) {
      const rawValue = top[2];
      keys[top[1]] = {
        value: rawValue.trim(),
        line: i + 2, // +1 for opening ---, +1 for 1-based
        col: 1,
        isArray: rawValue.trim().startsWith("[") || rawValue.trim() === "",
      };
    }
    offset += line.length + 1;
  }
  return { start: 0, end: m[0].length, keys };
}

function matchSchema(file: string): FrontmatterSchema | null {
  for (const schema of SCHEMAS) {
    if (schema.pathPattern.test(file)) return schema;
  }
  return null;
}

export const frontmatterSchema: Rule = {
  id: "frontmatter-schema",
  tier: "deterministic",
  severity: "warn",
  description: "Harness frontmatter violates its format's required-field schema.",
  examples: [
    {
      path: ".claude/agents/classify.md",
      bad: "---\nmodel: claude-3\n---",
      good: "---\ndescription: Classify role archetype\nmodel: claude-3\n---",
      why: "Claude Code agents require `description`. Without it, `/agents` list and self-description break.",
    },
  ],
  check(ctx) {
    const schema = matchSchema(ctx.file);
    if (!schema) return [];
    const parsed = parseFrontmatter(ctx.source);
    const findings: LintFinding[] = [];
    const anchor = rangeFromOffsets(ctx, 0, Math.min(ctx.source.length, 4));

    if (!parsed) {
      // Only complain if the format demands fields.
      if (schema.required.length > 0 || (schema.anyOf && schema.anyOf.length > 0)) {
        findings.push({
          rule_id: frontmatterSchema.id,
          severity: "warn",
          file: ctx.file,
          range: anchor,
          message: `${schema.name} has no YAML frontmatter. Required: ${schema.required.join(", ") || "one of " + JSON.stringify(schema.anyOf)}.`,
          snippet: ctx.source.slice(0, Math.min(40, ctx.source.length)),
        });
      }
      return findings;
    }

    for (const key of schema.required) {
      if (!parsed.keys[key] || !parsed.keys[key].value) {
        findings.push({
          rule_id: frontmatterSchema.id,
          severity: "warn",
          file: ctx.file,
          range: anchor,
          message: `${schema.name}: missing required frontmatter key "${key}".`,
          snippet: key,
        });
      }
    }

    if (schema.anyOf) {
      for (const group of schema.anyOf) {
        const hit = group.some((k) => parsed.keys[k] && parsed.keys[k].value !== "");
        if (!hit) {
          findings.push({
            rule_id: frontmatterSchema.id,
            severity: "warn",
            file: ctx.file,
            range: anchor,
            message: `${schema.name}: must have at least one of: ${group.join(", ")}.`,
            snippet: group.join(","),
          });
        }
      }
    }

    for (const arrayKey of schema.arrayKeys ?? []) {
      const kv = parsed.keys[arrayKey];
      if (!kv) continue;
      const v = kv.value;
      if (v && !v.startsWith("[") && !v.startsWith("-")) {
        findings.push({
          rule_id: frontmatterSchema.id,
          severity: "warn",
          file: ctx.file,
          range: anchor,
          message: `${schema.name}: key "${arrayKey}" should be an array (e.g. "${arrayKey}: [a, b]"), got "${v.slice(0, 30)}".`,
          snippet: arrayKey,
        });
      }
    }

    return findings;
  },
};

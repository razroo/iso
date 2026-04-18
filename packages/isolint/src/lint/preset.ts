import { DETERMINISTIC_RULES } from "./rules/deterministic.js";
import { LLM_RULES } from "./rules/llm.js";
import { PERFORMANCE_RULES } from "./rules/performance.js";
import type { Rule, RulePreset } from "./types.js";

export const ALL_RULES: Rule[] = [...DETERMINISTIC_RULES, ...PERFORMANCE_RULES, ...LLM_RULES];

/** Recommended preset: every deterministic rule at its default severity, LLM rules off. */
export const RECOMMENDED: RulePreset = {
  id: "recommended",
  description: "Deterministic rules only. Zero cost. Safe for CI.",
  rules: DETERMINISTIC_RULES,
};

/** Strict preset: deterministic rules + LLM rules enabled. */
export const STRICT: RulePreset = {
  id: "strict",
  description: "All rules including LLM-assisted. Requires --llm model.",
  rules: [...DETERMINISTIC_RULES, ...LLM_RULES],
};

/** Performance preset: advisory harness-efficiency rules. */
export const PERFORMANCE: RulePreset = {
  id: "performance",
  description: "Advisory rules for prompt size, duplication, and avoidable latency.",
  rules: PERFORMANCE_RULES,
};

export const PRESETS: Record<string, RulePreset> = {
  recommended: RECOMMENDED,
  strict: STRICT,
  performance: PERFORMANCE,
};

export function rulesFromPresets(names: string[]): Rule[] {
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const name of names) {
    const preset = PRESETS[name];
    if (!preset) continue;
    for (const rule of preset.rules) {
      if (!seen.has(rule.id)) {
        seen.add(rule.id);
        out.push(rule);
      }
    }
  }
  return out;
}

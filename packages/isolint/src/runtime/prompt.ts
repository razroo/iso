import type { Step } from "../schema/plan.js";
import { formatSpec } from "./constraints.js";

/**
 * Build a TINY, deterministic prompt for the small model.
 *
 * Design goals:
 *  - No persona preamble. No "You are a helpful assistant". The small
 *    model already had that training; we just need the task.
 *  - Structured, labeled sections so a 7B model can parse them cheaply.
 *  - Explicit output contract so the model knows what format to emit.
 */
export const RUNTIME_SYSTEM_PROMPT =
  "You are an executor. Follow the INSTRUCTION exactly. " +
  "Return ONLY the OUTPUT in the specified format. No explanations, no preamble, no markdown fences.";

export function buildStepPrompt(
  step: Step,
  resolvedInputs: Record<string, unknown>,
): string {
  const inputBlock = Object.keys(resolvedInputs).length
    ? Object.entries(resolvedInputs)
        .map(([k, v]) => `${k}:\n${stringify(v)}`)
        .join("\n\n")
    : "(none)";

  const constraints = step.constraints.length
    ? step.constraints.map((c, i) => `  ${i + 1}. ${c.rule}`).join("\n")
    : "  (none)";

  return [
    `INSTRUCTION: ${step.instruction}`,
    ``,
    `INPUTS:`,
    inputBlock,
    ``,
    `CONSTRAINTS:`,
    constraints,
    ``,
    `OUTPUT FORMAT: ${formatSpec(step.expected_output)}`,
    ``,
    `Return the OUTPUT now.`,
  ].join("\n");
}

export function buildRepairPrompt(
  step: Step,
  resolvedInputs: Record<string, unknown>,
  previous: string,
  errors: string[],
): string {
  return [
    buildStepPrompt(step, resolvedInputs),
    ``,
    `PREVIOUS OUTPUT (invalid):`,
    previous,
    ``,
    `ERRORS TO FIX:`,
    ...errors.map((e) => `  - ${e}`),
    ``,
    `Return a corrected OUTPUT that fixes ALL errors.`,
  ].join("\n");
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}

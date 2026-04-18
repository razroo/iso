import type { ModelProvider } from "../providers/types.js";
import type { Plan } from "../schema/plan.js";
import { formatPlanPerformance, lintPlanPerformance } from "../schema/performance.js";
import { assertPlan } from "../schema/validate.js";
import { extractJSON } from "../util/json.js";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt } from "./prompt.js";

export interface GeneratePlanOptions {
  task: string;
  hints?: string;
  /** Max attempts to produce a schema-valid, performance-clean plan. */
  max_attempts?: number;
}

export interface GeneratePlanResult {
  plan: Plan;
  raw: string;
  attempts: number;
  model: string;
}

/**
 * Planner: uses a LARGE model to turn a task description into a strict Plan.
 *
 * Self-repairing: if the first output is invalid JSON or fails the Plan
 * schema, or if it passes schema validation but still has plan-performance
 * findings, we feed that feedback back and ask for a corrected plan.
 */
export class Planner {
  constructor(private readonly model: ModelProvider) {}

  async generate(opts: GeneratePlanOptions): Promise<GeneratePlanResult> {
    const maxAttempts = opts.max_attempts ?? 3;
    let lastErr = "";
    let raw = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const userPrompt =
        attempt === 1
          ? buildPlannerUserPrompt(opts.task, opts.hints)
          : buildRepairPrompt(opts.task, raw, lastErr);

      const res = await this.model.complete({
        messages: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        json_mode: true,
        max_tokens: 4096,
      });
      raw = res.content;

      try {
        const parsed = extractJSON(raw);
        assertPlan(parsed);
        const perfFindings = lintPlanPerformance(parsed);
        if (perfFindings.length > 0) {
          lastErr =
            "The Plan is schema-valid but still has plan-performance findings.\n" +
            formatPlanPerformance(perfFindings);
          continue;
        }
        return { plan: parsed, raw, attempts: attempt, model: res.model };
      } catch (err) {
        lastErr = (err as Error).message;
      }
    }

    throw new Error(
      `Planner failed after ${maxAttempts} attempts.\nLast error: ${lastErr}\nLast output:\n${raw.slice(0, 1000)}`,
    );
  }
}

function buildRepairPrompt(task: string, previous: string, errors: string): string {
  return `Your previous output needs repair.

Task:
${task}

Previous output:
${previous}

Validation errors:
${errors}

Return a corrected JSON Plan that fixes ALL the issues. JSON only.`;
}

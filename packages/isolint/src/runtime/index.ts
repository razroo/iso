import type { ModelProvider } from "../providers/types.js";
import type { Plan, Step } from "../schema/plan.js";
import { validateAgainstJSONSchema } from "../schema/validate.js";
import { createLogger, type Logger } from "../util/logger.js";
import { checkOutput } from "./constraints.js";
import {
  RUNTIME_SYSTEM_PROMPT,
  buildRepairPrompt,
  buildStepPrompt,
} from "./prompt.js";

export interface StepResult {
  step_id: string;
  ok: boolean;
  attempts: number;
  /** Coerced output (string for text/enum, parsed value for json/list). */
  output: unknown;
  /** Validation errors from the final attempt (empty if ok). */
  errors: string[];
  /** Tokens used across all attempts, when reported by provider. */
  tokens?: number;
}

export interface RunResult {
  plan: string;
  steps: StepResult[];
  final: unknown;
  ok: boolean;
  total_tokens?: number;
}

export interface RunOptions {
  logger?: Logger;
  /** Override temperature for the executor. */
  temperature?: number;
}

/**
 * Runtime: executes a Plan using a SMALL model.
 *
 * It resolves each step's `inputs` from either `$input` or prior step
 * outputs, builds a tiny deterministic prompt, validates the output
 * against the step's OutputFormat + Constraints, and applies the
 * step's failure_handling strategy when validation fails.
 */
export class Runtime {
  private readonly log: Logger;

  constructor(
    private readonly model: ModelProvider,
    private readonly defaultOpts: RunOptions = {},
  ) {
    this.log = defaultOpts.logger ?? createLogger("info");
  }

  async run(plan: Plan, input: unknown, opts: RunOptions = {}): Promise<RunResult> {
    const log = opts.logger ?? this.log;
    const temperature = opts.temperature ?? this.defaultOpts.temperature ?? 0.0;

    const inputCheck = validateAgainstJSONSchema(input, plan.input_schema);
    if (!inputCheck.ok) {
      throw new Error(`Input does not match plan.input_schema:\n${inputCheck.errors.join("\n")}`);
    }

    const stepOutputs = new Map<string, unknown>();
    const stepResults: StepResult[] = [];
    let totalTokens = 0;

    for (const step of plan.steps) {
      log.info(`step "${step.id}" start`, { title: step.title });
      const result = await this.runStep(step, input, stepOutputs, temperature, log);
      stepResults.push(result);
      totalTokens += result.tokens ?? 0;

      if (!result.ok) {
        log.error(`step "${step.id}" failed`, { errors: result.errors });
        return {
          plan: plan.name,
          steps: stepResults,
          final: null,
          ok: false,
          total_tokens: totalTokens || undefined,
        };
      }

      stepOutputs.set(step.id, result.output);
      log.info(`step "${step.id}" ok`, { attempts: result.attempts });
    }

    const final = composeFinal(plan.final_output, stepOutputs);
    return {
      plan: plan.name,
      steps: stepResults,
      final,
      ok: true,
      total_tokens: totalTokens || undefined,
    };
  }

  private async runStep(
    step: Step,
    input: unknown,
    priorOutputs: Map<string, unknown>,
    temperature: number,
    log: Logger,
  ): Promise<StepResult> {
    const resolvedInputs = resolveInputs(step.inputs, input, priorOutputs);

    let prompt = buildStepPrompt(step, resolvedInputs);
    let lastRaw = "";
    let lastErrors: string[] = [];
    let tokens = 0;

    const maxAttempts = step.failure_handling.max_retries + 1;
    const needsJSON =
      step.expected_output.kind === "json" || step.expected_output.kind === "list";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.model.complete({
        messages: [
          { role: "system", content: RUNTIME_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature,
        json_mode: needsJSON,
        max_tokens: 1024,
      });
      tokens += res.usage?.total_tokens ?? 0;
      lastRaw = res.content;

      const check = checkOutput(lastRaw, step.expected_output, step.constraints);
      if (check.ok) {
        return {
          step_id: step.id,
          ok: true,
          attempts: attempt,
          output: check.value,
          errors: [],
          tokens: tokens || undefined,
        };
      }
      lastErrors = check.errors;
      log.debug(`step "${step.id}" attempt ${attempt} invalid`, { errors: check.errors });

      const strategy = step.failure_handling.on_invalid;
      if (attempt === maxAttempts) break;

      if (strategy === "fail") break;
      if (strategy === "fallback") break;
      if (strategy === "repair") {
        prompt = buildRepairPrompt(step, resolvedInputs, lastRaw, check.errors);
      }
    }

    if (step.failure_handling.on_invalid === "fallback") {
      return {
        step_id: step.id,
        ok: true,
        attempts: maxAttempts,
        output: step.failure_handling.fallback_value ?? null,
        errors: lastErrors,
        tokens: tokens || undefined,
      };
    }

    return {
      step_id: step.id,
      ok: false,
      attempts: maxAttempts,
      output: lastRaw,
      errors: lastErrors,
      tokens: tokens || undefined,
    };
  }
}

function resolveInputs(
  refs: string[],
  input: unknown,
  priorOutputs: Map<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ref of refs) {
    if (ref === "$input") {
      out["$input"] = input;
    } else if (ref.startsWith("$steps.")) {
      const id = ref.slice("$steps.".length);
      if (!priorOutputs.has(id)) {
        throw new Error(`Step references unknown prior step: ${ref}`);
      }
      out[ref] = priorOutputs.get(id);
    } else {
      out[ref] = ref;
    }
  }
  return out;
}

function composeFinal(
  spec: Plan["final_output"],
  outputs: Map<string, unknown>,
): unknown {
  if (typeof spec === "string") {
    const id = spec.startsWith("$steps.") ? spec.slice("$steps.".length) : spec;
    if (!outputs.has(id)) {
      throw new Error(`final_output references unknown step: ${spec}`);
    }
    return outputs.get(id);
  }
  const composed: Record<string, unknown> = {};
  for (const [key, ref] of Object.entries(spec)) {
    const id = ref.startsWith("$steps.") ? ref.slice("$steps.".length) : ref;
    if (!outputs.has(id)) {
      throw new Error(`final_output.${key} references unknown step: ${ref}`);
    }
    composed[key] = outputs.get(id);
  }
  return composed;
}

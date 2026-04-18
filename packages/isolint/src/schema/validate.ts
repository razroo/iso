import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { PLAN_JSON_SCHEMA, type JSONSchema, type Plan } from "./plan.js";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validatePlanFn: ValidateFunction = ajv.compile(PLAN_JSON_SCHEMA);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validatePlan(plan: unknown): ValidationResult {
  const ok = validatePlanFn(plan) as boolean;
  return {
    ok,
    errors: ok ? [] : formatErrors(validatePlanFn.errors ?? []),
  };
}

export function validateAgainstJSONSchema(
  value: unknown,
  schema: JSONSchema,
): ValidationResult {
  try {
    const fn = ajv.compile(schema as object);
    const ok = fn(value) as boolean;
    return { ok, errors: ok ? [] : formatErrors(fn.errors ?? []) };
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }
}

export function assertPlan(plan: unknown): asserts plan is Plan {
  const res = validatePlan(plan);
  if (!res.ok) {
    throw new Error(`Invalid plan:\n${res.errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

function formatErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message ?? "invalid"}`.trim();
  });
}

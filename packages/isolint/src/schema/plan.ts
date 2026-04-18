/**
 * Isolint Plan Schema
 * ---------------------
 * A Plan is the structural isomorphism: a large model emits it once,
 * a small model executes it repeatedly. Every field is designed to
 * eliminate ambiguity so a 7B model can execute it reliably.
 */

export type OutputFormat =
  | { kind: "text"; max_chars?: number; min_chars?: number }
  | { kind: "json"; json_schema: JSONSchema }
  | { kind: "enum"; values: string[] }
  | { kind: "list"; item_format: OutputFormat; min_items?: number; max_items?: number };

export interface JSONSchema {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: (string | number | boolean | null)[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
}

export interface Constraint {
  /** One atomic rule. e.g. "no exclamation marks", "<=120 words". */
  rule: string;
  /** Optional regex the output must match. */
  must_match?: string;
  /** Optional regex the output must NOT match. */
  must_not_match?: string;
}

export interface FailureHandling {
  /** Number of retries before giving up on a step. */
  max_retries: number;
  /**
   * Strategy when validation fails repeatedly.
   * - "retry": re-run same prompt
   * - "repair": feed validator errors back to the model and ask for fix
   * - "fallback": return a deterministic fallback value
   * - "fail": abort the plan
   */
  on_invalid: "retry" | "repair" | "fallback" | "fail";
  fallback_value?: unknown;
}

export interface Step {
  /** Stable identifier referenced by later steps (kebab-case). */
  id: string;
  /** Short human-readable title (≤60 chars). */
  title: string;
  /**
   * Atomic instruction to the executor. No meta-talk, no "be creative".
   * Must be phrased as an imperative. Single task per step.
   */
  instruction: string;
  /**
   * Inputs available to this step:
   *  - "$input"        -> the user-provided input
   *  - "$steps.<id>"   -> the output of a prior step
   * Anything else is treated as a literal string.
   */
  inputs: string[];
  constraints: Constraint[];
  expected_output: OutputFormat;
  failure_handling: FailureHandling;
}

export interface Plan {
  /** Schema version for forward compatibility. */
  version: "1";
  /** Human-readable name, e.g. "cold-email-v1". */
  name: string;
  /** One-line description of what this plan does. */
  description: string;
  /**
   * Shape of the user input this plan consumes.
   * Allows the runtime to validate `$input` before execution begins.
   */
  input_schema: JSONSchema;
  /** Ordered list of atomic steps. */
  steps: Step[];
  /**
   * Which step's output (or a deterministic composition) is the final result.
   * Either a single step id or a JSON object whose values are `$steps.<id>` refs.
   */
  final_output: string | Record<string, string>;
}

/** JSON-Schema (draft-07) representation of the Plan for ajv validation. */
export const PLAN_JSON_SCHEMA = {
  $id: "https://isolint.dev/schema/plan.json",
  type: "object",
  required: [
    "version",
    "name",
    "description",
    "input_schema",
    "steps",
    "final_output",
  ],
  additionalProperties: false,
  properties: {
    version: { const: "1" },
    name: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", minLength: 1, maxLength: 500 },
    input_schema: { $ref: "#/definitions/jsonSchema" },
    steps: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/definitions/step" },
    },
    final_output: {
      oneOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          additionalProperties: { type: "string" },
          minProperties: 1,
        },
      ],
    },
  },
  definitions: {
    jsonSchema: {
      type: "object",
      additionalProperties: true,
    },
    constraint: {
      type: "object",
      required: ["rule"],
      additionalProperties: false,
      properties: {
        rule: { type: "string", minLength: 1, maxLength: 200 },
        must_match: { type: "string" },
        must_not_match: { type: "string" },
      },
    },
    outputFormat: {
      type: "object",
      additionalProperties: true,
      required: ["kind"],
      properties: {
        kind: { enum: ["text", "json", "enum", "list"] },
      },
    },
    failureHandling: {
      type: "object",
      required: ["max_retries", "on_invalid"],
      additionalProperties: false,
      properties: {
        max_retries: { type: "integer", minimum: 0, maximum: 5 },
        on_invalid: { enum: ["retry", "repair", "fallback", "fail"] },
        fallback_value: {},
      },
    },
    step: {
      type: "object",
      required: [
        "id",
        "title",
        "instruction",
        "inputs",
        "constraints",
        "expected_output",
        "failure_handling",
      ],
      additionalProperties: false,
      properties: {
        id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,48}$" },
        title: { type: "string", minLength: 1, maxLength: 60 },
        instruction: { type: "string", minLength: 1, maxLength: 2000 },
        inputs: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { $ref: "#/definitions/constraint" } },
        expected_output: { $ref: "#/definitions/outputFormat" },
        failure_handling: { $ref: "#/definitions/failureHandling" },
      },
    },
  },
} as const;

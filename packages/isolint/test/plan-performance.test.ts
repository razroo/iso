import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { formatPlanPerformance, lintPlanPerformance } from "../src/schema/performance.js";
import type { Plan } from "../src/schema/plan.js";

const basePlan: Plan = {
  version: "1",
  name: "plan-perf",
  description: "test",
  input_schema: {
    type: "object",
    required: ["ticket"],
    properties: {
      ticket: { type: "string" },
    },
  },
  steps: [
    {
      id: "classify",
      title: "Classify",
      instruction: "Classify the ticket into one category.",
      inputs: ["$input"],
      constraints: [],
      expected_output: { kind: "enum", values: ["bug", "billing", "other"] },
      failure_handling: { max_retries: 1, on_invalid: "retry" },
    },
  ],
  final_output: "$steps.classify",
};

describe("plan performance", () => {
  it("bundled example plans produce no performance findings", () => {
    const examplesDir = resolve(process.cwd(), "examples");
    for (const dir of readdirSync(examplesDir)) {
      const planPath = resolve(examplesDir, dir, "plan.json");
      try {
        statSync(planPath);
      } catch {
        continue;
      }
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
      const findings = lintPlanPerformance(plan);
      assert.equal(
        findings.length,
        0,
        `${dir}/plan.json should not emit plan-performance findings:\n${formatPlanPerformance(findings)}`,
      );
    }
  });

  it("flags a long low-signal instruction", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          ...basePlan.steps[0],
          instruction: "Review the ticket in a thoughtful and comprehensive way, consider the surrounding context, account for the broader product situation, keep the overall user experience in mind, reflect on adjacent concerns, and provide the best possible output while maintaining a holistic view of the case and its implications for the final answer.",
        },
      ],
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-long-instruction"));
  });

  it("flags duplicated output contracts already encoded in expected_output", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          id: "emit-json",
          title: "Emit JSON",
          instruction: "Return JSON with owner and score.",
          inputs: ["$input"],
          constraints: [],
          expected_output: {
            kind: "json",
            json_schema: {
              type: "object",
              required: ["owner", "score"],
              additionalProperties: false,
              properties: {
                owner: { type: "string" },
                score: { type: "number" },
              },
            },
          },
          failure_handling: { max_retries: 1, on_invalid: "repair" },
        },
      ],
      final_output: "$steps.emit-json",
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-duplicated-output-contract"));
  });

  it("does not flag enum steps for restating the label shape", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          ...basePlan.steps[0],
          instruction: "Return one category label for the ticket.",
        },
      ],
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(!findings.some((f) => f.rule_id === "perf-plan-duplicated-output-contract"));
  });

  it("flags redundant schema prose in json steps", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          id: "extract",
          title: "Extract",
          instruction: "Return a JSON object with fields title, owner, and score.",
          inputs: ["$input"],
          constraints: [],
          expected_output: {
            kind: "json",
            json_schema: {
              type: "object",
              required: ["title", "owner", "score"],
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                owner: { type: "string" },
                score: { type: "number" },
              },
            },
          },
          failure_handling: { max_retries: 1, on_invalid: "repair" },
        },
      ],
      final_output: "$steps.extract",
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-redundant-schema-prose"));
  });

  it("flags structured outputs that also ask for explanation", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          id: "root-cause",
          title: "Root cause",
          instruction: "Return a JSON object with owner and score, and explain why the score fits.",
          inputs: ["$input"],
          constraints: [],
          expected_output: {
            kind: "json",
            json_schema: {
              type: "object",
              required: ["owner", "score"],
              additionalProperties: false,
              properties: {
                owner: { type: "string" },
                score: { type: "number" },
              },
            },
          },
          failure_handling: { max_retries: 1, on_invalid: "repair" },
        },
      ],
      final_output: "$steps.root-cause",
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-structured-output-explanation"));
  });

  it("flags tone/style overhead on structured outputs", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          id: "emit-json",
          title: "Emit JSON",
          instruction: "Return JSON in a friendly and professional tone.",
          inputs: ["$input"],
          constraints: [],
          expected_output: {
            kind: "json",
            json_schema: {
              type: "object",
              required: ["category"],
              additionalProperties: false,
              properties: {
                category: { type: "string" },
              },
            },
          },
          failure_handling: { max_retries: 1, on_invalid: "repair" },
        },
      ],
      final_output: "$steps.emit-json",
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-style-tone-overhead"));
  });

  it("flags redundant numeric constraints already enforced by schema", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          id: "score",
          title: "Score",
          instruction: "Return JSON for the score.",
          inputs: ["$input"],
          constraints: [
            { rule: "All numeric fields are JSON numbers, not strings" },
          ],
          expected_output: {
            kind: "json",
            json_schema: {
              type: "object",
              required: ["score"],
              additionalProperties: false,
              properties: {
                score: { type: "number" },
              },
            },
          },
          failure_handling: { max_retries: 1, on_invalid: "repair" },
        },
      ],
      final_output: "$steps.score",
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-redundant-constraint"));
  });

  it("flags steps that restate prior steps", () => {
    const plan: Plan = {
      ...basePlan,
      steps: [
        {
          ...basePlan.steps[0],
          instruction: "Classify the ticket into one category using the ticket text.",
        },
        {
          id: "classify-again",
          title: "Classify again",
          instruction: "Classify the ticket into one category using the ticket text.",
          inputs: ["$input"],
          constraints: [],
          expected_output: { kind: "enum", values: ["bug", "billing", "other"] },
          failure_handling: { max_retries: 1, on_invalid: "retry" },
        },
      ],
      final_output: "$steps.classify-again",
    };
    const findings = lintPlanPerformance(plan);
    assert.ok(findings.some((f) => f.rule_id === "perf-plan-restated-step"));
  });

  it("formats an empty report cleanly", () => {
    assert.equal(formatPlanPerformance([]), "performance: no findings");
  });
});

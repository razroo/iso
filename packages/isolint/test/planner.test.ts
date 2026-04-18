import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Planner } from "../src/planner/index.js";
import type { Plan } from "../src/schema/plan.js";
import { lintPlanPerformance } from "../src/schema/performance.js";
import { MockProvider } from "../src/providers/mock.js";

function makePlan(instruction: string): Plan {
  return {
    version: "1",
    name: "planner-test",
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
        id: "extract",
        title: "Extract",
        instruction,
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
    final_output: "$steps.extract",
  };
}

describe("planner", () => {
  it("retries when a schema-valid plan still has performance findings", async () => {
    const noisyPlan = makePlan("Return a JSON object with fields owner and score.");
    const cleanPlan = makePlan("Extract the owner and score from the ticket.");

    let calls = 0;
    let repairPrompt = "";
    const model = new MockProvider("planner", (req) => {
      calls++;
      if (calls === 1) return JSON.stringify(noisyPlan);
      repairPrompt = req.messages[1]?.content ?? "";
      return JSON.stringify(cleanPlan);
    });

    const planner = new Planner(model);
    const result = await planner.generate({ task: "Extract owner and score from a ticket." });

    assert.equal(result.attempts, 2);
    assert.equal(lintPlanPerformance(result.plan).length, 0);
    assert.match(repairPrompt, /perf-plan-duplicated-output-contract/);
    assert.match(repairPrompt, /perf-plan-redundant-schema-prose/);
  });

  it("fails if it cannot produce a performance-clean plan within max_attempts", async () => {
    const noisyPlan = makePlan("Return a JSON object with fields owner and score.");
    const planner = new Planner(new MockProvider("planner-stuck", () => JSON.stringify(noisyPlan)));

    await assert.rejects(
      () => planner.generate({ task: "Extract owner and score from a ticket.", max_attempts: 2 }),
      /plan-performance findings|perf-plan-duplicated-output-contract/i,
    );
  });
});

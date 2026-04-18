import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../src/providers/mock.js";
import { Runtime } from "../src/runtime/index.js";
import type { Plan } from "../src/schema/plan.js";
import { createLogger } from "../src/util/logger.js";

const silent = createLogger("silent");

const simplePlan: Plan = {
  version: "1",
  name: "echo",
  description: "echo test",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
  steps: [
    {
      id: "greet",
      title: "Greet",
      instruction: "Return a greeting",
      inputs: ["$input"],
      constraints: [{ rule: "starts with hello", must_match: "^hello" }],
      expected_output: { kind: "text", min_chars: 5, max_chars: 50 },
      failure_handling: { max_retries: 2, on_invalid: "retry" },
    },
  ],
  final_output: "$steps.greet",
};

describe("runtime", () => {
  it("executes a valid plan and returns the final output", async () => {
    const model = new MockProvider("ok", () => "hello world");
    const runtime = new Runtime(model, { logger: silent });
    const res = await runtime.run(simplePlan, { name: "ada" });
    assert.equal(res.ok, true);
    assert.equal(res.final, "hello world");
    assert.equal(res.steps[0].attempts, 1);
  });

  it("retries then succeeds when constraint initially fails", async () => {
    let n = 0;
    const model = new MockProvider("retry", () => (++n < 2 ? "nope" : "hello there"));
    const runtime = new Runtime(model, { logger: silent });
    const res = await runtime.run(simplePlan, { name: "ada" });
    assert.equal(res.ok, true);
    assert.equal(res.steps[0].attempts, 2);
  });

  it("uses fallback when on_invalid=fallback", async () => {
    const plan: Plan = {
      ...simplePlan,
      steps: [
        {
          ...simplePlan.steps[0],
          failure_handling: {
            max_retries: 1,
            on_invalid: "fallback",
            fallback_value: "hello fallback",
          },
        },
      ],
    };
    const model = new MockProvider("bad", () => "nope");
    const runtime = new Runtime(model, { logger: silent });
    const res = await runtime.run(plan, { name: "ada" });
    assert.equal(res.ok, true);
    assert.equal(res.final, "hello fallback");
  });

  it("rejects input that violates input_schema", async () => {
    const model = new MockProvider("ok", () => "hello world");
    const runtime = new Runtime(model, { logger: silent });
    await assert.rejects(() => runtime.run(simplePlan, { wrong: 1 }), /input_schema/);
  });

  it("validates a json-output step against its schema", async () => {
    const plan: Plan = {
      version: "1",
      name: "json",
      description: "json test",
      input_schema: { type: "object" },
      steps: [
        {
          id: "extract",
          title: "Extract",
          instruction: "Return JSON {a:number}",
          inputs: [],
          constraints: [],
          expected_output: {
            kind: "json",
            json_schema: {
              type: "object",
              required: ["a"],
              additionalProperties: false,
              properties: { a: { type: "number" } },
            },
          },
          failure_handling: { max_retries: 0, on_invalid: "fail" },
        },
      ],
      final_output: "$steps.extract",
    };
    const model = new MockProvider("json", () => '```json\n{"a": 42}\n```');
    const runtime = new Runtime(model, { logger: silent });
    const res = await runtime.run(plan, {});
    assert.equal(res.ok, true);
    assert.deepEqual(res.final, { a: 42 });
  });
});

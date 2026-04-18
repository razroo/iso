import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validatePlan } from "../src/schema/validate.js";

const EXAMPLES_DIR = resolve(process.cwd(), "examples");

describe("plan schema", () => {
  it("rejects plans missing required fields", () => {
    const res = validatePlan({ version: "1" });
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  });

  it("rejects unknown version", () => {
    const res = validatePlan({
      version: "2",
      name: "x",
      description: "x",
      input_schema: { type: "object" },
      steps: [
        {
          id: "a",
          title: "t",
          instruction: "i",
          inputs: [],
          constraints: [],
          expected_output: { kind: "text" },
          failure_handling: { max_retries: 0, on_invalid: "fail" },
        },
      ],
      final_output: "a",
    });
    assert.equal(res.ok, false);
  });

  it("validates every example plan", () => {
    for (const dir of readdirSync(EXAMPLES_DIR)) {
      const planPath = resolve(EXAMPLES_DIR, dir, "plan.json");
      try {
        statSync(planPath);
      } catch {
        continue;
      }
      const plan = JSON.parse(readFileSync(planPath, "utf8"));
      const res = validatePlan(plan);
      assert.ok(res.ok, `${dir}/plan.json invalid:\n${res.errors.join("\n")}`);
    }
  });
});

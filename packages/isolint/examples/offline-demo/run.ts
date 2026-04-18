/**
 * Offline demo - no API key required.
 *
 * Simulates the full Isomodel loop:
 *   1. A mock LARGE model returns a pre-baked structured Plan.
 *   2. A mock SMALL model executes each step with deterministic stubs.
 *   3. Outputs are validated against the Plan schema end-to-end.
 *
 * Run with:  npx tsx examples/offline-demo/run.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { MockProvider } from "../../src/providers/mock.js";
import { Runtime } from "../../src/runtime/index.js";
import { assertPlan, type Plan } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function loadPlan(rel: string): Plan {
  const plan = JSON.parse(readFileSync(resolve(repoRoot, rel), "utf8"));
  assertPlan(plan);
  return plan;
}

function loadInput(rel: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), "utf8"));
}

// Deterministic "small model": matches step ids from the triage plan.
const smallModel = new MockProvider("triage-executor", (req) => {
  const user = req.messages.find((m) => m.role === "user")?.content ?? "";
  const instruction = user.match(/^INSTRUCTION:\s*(.+)$/m)?.[1] ?? "";

  if (instruction.startsWith("Read the ticket")) return "bug";
  if (instruction.startsWith("Return one severity")) return "P0";
  if (instruction.startsWith("Given the category and the ticket")) {
    return JSON.stringify({
      root_cause: "Deploy queue worker stalled",
      confidence: 0.78,
    });
  }
  if (instruction.startsWith("Given the category, severity")) {
    return JSON.stringify({
      owner: "engineering",
      action: "Page on-call SRE to inspect deploy-queue worker health",
      sla_hours: 1,
    });
  }
  throw new Error(`MockProvider: unhandled instruction:\n${instruction.slice(0, 200)}`);
});

const plan = loadPlan("examples/multi-step-reasoning/plan.json");
const input = loadInput("examples/multi-step-reasoning/input.json");

const runtime = new Runtime(smallModel);
const result = await runtime.run(plan, input);

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
if (!result.ok) process.exit(1);

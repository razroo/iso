import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { Plan } from "../src/schema/plan.js";
import { formatPlanPerformance, lintPlanPerformance } from "../src/schema/performance.js";
import { assertPlan } from "../src/schema/validate.js";

const examplesDir = resolve(process.cwd(), "examples");
let failures = 0;

for (const dir of readdirSync(examplesDir)) {
  const planPath = resolve(examplesDir, dir, "plan.json");
  try {
    statSync(planPath);
  } catch {
    continue;
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;

  try {
    assertPlan(plan);
  } catch (err) {
    failures++;
    process.stderr.write(`${dir}/plan.json is invalid:\n${(err as Error).message}\n`);
    continue;
  }

  const findings = lintPlanPerformance(plan);
  if (findings.length > 0) {
    failures++;
    process.stderr.write(
      `${dir}/plan.json has plan-performance findings:\n${formatPlanPerformance(findings)}\n`,
    );
    continue;
  }

  process.stdout.write(`${dir}/plan.json ok\n`);
}

if (failures > 0) {
  process.stderr.write(`\n${failures} example plan check${failures === 1 ? "" : "s"} failed\n`);
  process.exit(1);
}

process.stdout.write("\nAll bundled example plans are schema-valid and performance-clean.\n");

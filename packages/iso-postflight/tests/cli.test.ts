import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-postflight cli", () => {
  it("prints status and exits cleanly for an incomplete workflow", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-postflight-cli-"));
    const config = join(dir, "postflight.json");
    const plan = join(dir, "plan.json");
    const outcomes = join(dir, "outcomes.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(plan, JSON.stringify(examplePlan(), null, 2));
    writeFileSync(outcomes, JSON.stringify({ dispatches: [], outcomes: [] }, null, 2));

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "status", "--config", config, "--plan", plan, "--outcomes", outcomes], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /iso-postflight: STATUS workflow=jobforge.apply/);
    assert.match(result.stdout, /dispatch-round/);
  });

  it("check exits 1 when required post steps are pending", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-postflight-cli-"));
    const config = join(dir, "postflight.json");
    const plan = join(dir, "plan.json");
    const outcomes = join(dir, "outcomes.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(plan, JSON.stringify(examplePlan(), null, 2));
    writeFileSync(outcomes, JSON.stringify({
      dispatches: [{ candidateId: "job-1" }],
      outcomes: [applied("job-1")],
    }, null, 2));

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "check", "--config", config, "--plan", plan, "--outcomes", outcomes], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /iso-postflight: FAIL/);
    assert.match(result.stdout, /run-post-step/);
  });

  it("check exits 0 when all outcomes and post steps are complete", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-postflight-cli-"));
    const config = join(dir, "postflight.json");
    const plan = join(dir, "plan.json");
    const outcomes = join(dir, "outcomes.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(plan, JSON.stringify(examplePlan(), null, 2));
    writeFileSync(outcomes, JSON.stringify({
      dispatches: [{ candidateId: "job-1" }],
      outcomes: [applied("job-1")],
      steps: [{ id: "merge", status: "pass" }],
    }, null, 2));

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "check", "--config", config, "--plan", plan, "--outcomes", outcomes], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /iso-postflight: PASS/);
    assert.match(result.stdout, /state: complete/);
  });
});

function exampleConfig() {
  return {
    version: 1,
    workflows: [
      {
        name: "jobforge.apply",
        successStatuses: ["APPLIED"],
        failureStatuses: ["APPLY FAILED"],
        skipStatuses: ["SKIP"],
        requiredArtifacts: [{ id: "tracker-tsv", statuses: ["APPLIED", "APPLY FAILED", "SKIP"] }],
        postSteps: [{ id: "merge", label: "Merge", command: "npx job-forge merge" }],
      },
    ],
  };
}

function examplePlan() {
  return {
    workflow: { name: "jobforge.apply" },
    rounds: [{ index: 1, candidates: [{ id: "job-1" }] }],
  };
}

function applied(candidateId: string) {
  return {
    candidateId,
    status: "APPLIED",
    artifacts: [{ id: "tracker-tsv", status: "present", source: `batch/${candidateId}.tsv` }],
  };
}

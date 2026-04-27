import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPostflightResult, loadPostflightConfig, settlePostflight } from "../src/index.js";
import type { PostflightConfig } from "../src/index.js";

const config: PostflightConfig = loadPostflightConfig({
  version: 1,
  workflows: [
    {
      name: "jobforge.apply",
      successStatuses: ["APPLIED"],
      failureStatuses: ["APPLY FAILED"],
      skipStatuses: ["SKIP", "Discarded"],
      inFlightStatuses: ["running", "in-flight"],
      replacementStatuses: ["APPLY FAILED"],
      requiredArtifacts: [{ id: "tracker-tsv", statuses: ["APPLIED", "APPLY FAILED", "SKIP", "Discarded"] }],
      postSteps: [
        { id: "merge", label: "Merge", command: "npx job-forge merge" },
        { id: "verify", label: "Verify", command: "npx job-forge verify" },
      ],
    },
  ],
});

const plan = {
  workflow: { name: "jobforge.apply" },
  rounds: [
    { index: 1, candidates: [{ id: "job-1" }, { id: "job-2" }] },
    { index: 2, candidates: [{ id: "job-3" }] },
  ],
};

describe("iso-postflight", () => {
  it("reports ready-for-next-round when prior rounds are complete and the next round is unstarted", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }],
      outcomes: [applied("job-1"), applied("job-2")],
    });

    assert.equal(result.ok, false);
    assert.equal(result.state, "ready-for-next-round");
    assert.equal(result.nextAction.kind, "dispatch-round");
    assert.equal(result.nextAction.round, 2);
    assert.deepEqual(result.nextAction.candidates, ["job-3"]);
    assert.match(formatPostflightResult(result), /Dispatch round 2/);
  });

  it("waits when a dispatched candidate is still in-flight", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }],
      outcomes: [applied("job-1"), { candidateId: "job-2", status: "running" }],
    });

    assert.equal(result.state, "in-flight");
    assert.equal(result.nextAction.kind, "wait");
    assert.deepEqual(result.nextAction.candidates, ["job-2"]);
  });

  it("collects output when a dispatched candidate has no outcome", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }],
      outcomes: [applied("job-1")],
    });

    assert.equal(result.state, "missing-output");
    assert.equal(result.nextAction.kind, "collect-output");
    assert.deepEqual(result.nextAction.candidates, ["job-2"]);
    assert.equal(result.issues[0]?.kind, "missing-outcome");
  });

  it("requires replacements for configured replacement statuses", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }],
      outcomes: [applied("job-1"), failed("job-2")],
    });

    assert.equal(result.state, "needs-replacement");
    assert.equal(result.nextAction.kind, "replace-candidates");
    assert.deepEqual(result.nextAction.candidates, ["job-2"]);
  });

  it("blocks terminal outcomes missing required artifacts", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }],
      outcomes: [applied("job-1"), { candidateId: "job-2", status: "APPLIED" }],
    });

    assert.equal(result.state, "blocked");
    assert.equal(result.nextAction.kind, "stop");
    assert.equal(result.issues[0]?.kind, "missing-artifact");
  });

  it("runs post steps after all rounds complete", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }, { candidateId: "job-3" }],
      outcomes: [applied("job-1"), applied("job-2"), applied("job-3")],
      steps: [{ id: "merge", status: "pass" }],
    });

    assert.equal(result.state, "needs-post-step");
    assert.equal(result.nextAction.kind, "run-post-step");
    assert.equal(result.nextAction.step?.id, "verify");
  });

  it("passes when all rounds and post steps are complete", () => {
    const result = settlePostflight(config, plan, {
      dispatches: [{ candidateId: "job-1" }, { candidateId: "job-2" }, { candidateId: "job-3" }],
      outcomes: [applied("job-1"), applied("job-2"), applied("job-3")],
      steps: [{ id: "merge", status: "pass" }, { id: "verify", status: "pass" }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.state, "complete");
    assert.equal(result.nextAction.kind, "complete");
  });
});

function applied(candidateId: string) {
  return {
    candidateId,
    status: "APPLIED",
    source: `batch/tracker-additions/${candidateId}.tsv`,
    artifacts: [{ id: "tracker-tsv", status: "present", source: `batch/tracker-additions/${candidateId}.tsv` }],
  };
}

function failed(candidateId: string) {
  return {
    candidateId,
    status: "APPLY FAILED",
    source: `batch/tracker-additions/${candidateId}.tsv`,
    artifacts: [{ id: "tracker-tsv", status: "present", source: `batch/tracker-additions/${candidateId}.tsv` }],
  };
}

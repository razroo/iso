import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkPrioritize,
  loadPrioritizeConfig,
  prioritize,
  selectPrioritized,
  verifyPrioritizeResult,
} from "../src/index.js";

describe("iso-prioritize", () => {
  it("ranks, gates, quotas, and selects deterministically", () => {
    const result = prioritize(exampleConfig(), exampleItems());

    assert.equal(result.profile, "jobforge-next-action");
    assert.equal(result.stats.total, 6);
    assert.equal(result.stats.selected, 3);
    assert.equal(result.stats.skipped, 3);
    assert.equal(result.stats.blocked, 0);
	assert.deepEqual(result.items.filter((item) => item.state === "selected").map((item) => item.id), [
	  "followup-datadog",
	  "apply-anthropic",
	  "pipeline-acme",
	]);

    const duplicateCompany = result.items.find((item) => item.id === "apply-anthropic-duplicate");
    assert.equal(duplicateCompany?.state, "skipped");
    assert.match(duplicateCompany?.reasons.join("\n") || "", /quota one-per-company/);

    const rejected = result.items.find((item) => item.id === "rejected-oldco");
    assert.equal(rejected?.state, "skipped");
    assert.match(rejected?.reasons.join("\n") || "", /terminal tracker state/);

    const selected = selectPrioritized(result);
    assert.equal(selected.stats.total, 3);
    assert.equal(selected.stats.selected, 3);
    assert.equal(verifyPrioritizeResult(result).ok, true);
    assert.equal(verifyPrioritizeResult(selected).ok, true);
  });

  it("checks minimum selected count and fail-on states", () => {
    const pass = checkPrioritize(exampleConfig(), exampleItems(), { minSelected: 3 });
    assert.equal(pass.ok, true);

    const fail = checkPrioritize(exampleConfig(), exampleItems(), { limit: 2, minSelected: 3 });
    assert.equal(fail.ok, false);
    assert.equal(fail.errors, 1);
    assert.match(fail.issues.map((issue) => issue.code).join(","), /min-selected-not-met/);

    const ignoreStates = checkPrioritize(exampleConfig(), exampleItems(), { limit: 2, minSelected: 0, failOn: "none" });
    assert.equal(ignoreStates.ok, true);
  });

  it("rejects invalid configs and result hashes", () => {
    assert.throws(() => loadPrioritizeConfig({ version: 1, profiles: [] }), /profiles/);
    assert.throws(() => loadPrioritizeConfig({ version: 1, profiles: [{ name: "x", criteria: [{ id: "a", field: "score", weight: 0 }] }] }), /weight/);

	const result = prioritize(exampleConfig(), exampleItems());
	const tampered = { ...result, profile: "tampered" };
	const verify = verifyPrioritizeResult(tampered);
	assert.equal(verify.ok, false);
	assert.match(verify.issues.map((issue) => issue.code).join(","), /id-mismatch/);

	const zeroLimit = verifyPrioritizeResult({ ...result, limit: 0 });
	assert.equal(zeroLimit.ok, false);
	assert.match(zeroLimit.issues.map((issue) => issue.code).join(","), /invalid-limit/);
  });
});

function exampleConfig() {
  return {
    version: 1,
    defaults: { profile: "jobforge-next-action", limit: 3 },
    profiles: [
      {
        name: "jobforge-next-action",
        criteria: [
          { id: "fit-score", field: "score", weight: 45, min: 0, max: 5, required: true },
          { id: "urgency", field: "urgency", weight: 30, min: 0, max: 10, default: 0 },
          { id: "age", field: "ageDays", weight: 15, min: 0, max: 30, default: 0 },
          { id: "source-quality", field: "sourceQuality", weight: 10, min: 0, max: 1, default: 0.5 },
        ],
        gates: [
          { id: "terminal", action: "skip", reason: "terminal tracker state", when: { where: { status: ["Rejected", "Discarded", "SKIP"] } } },
          { id: "duplicate", action: "skip", reason: "duplicate candidate", when: { where: { duplicate: true } } },
        ],
        adjustments: [
          { id: "due-follow-up", value: 6, reason: "follow-up is due now", when: { type: "followup", where: { timelineState: ["due", "overdue"] } } },
          { id: "dream-company", value: 8, reason: "company is on the priority list", when: { where: { priorityCompany: true } } },
        ],
        quotas: [
          { id: "one-per-company", field: "company", max: 1, reason: "keep selected queue diverse" },
        ],
      },
    ],
  };
}

function exampleItems() {
  return [
    {
      id: "apply-anthropic",
      key: "company-role:anthropic:applied-ai-engineer",
      type: "apply",
      title: "Anthropic - Applied AI Engineer",
      data: { company: "Anthropic", score: 4.6, urgency: 8, ageDays: 2, sourceQuality: 1, status: "Evaluated", priorityCompany: true },
    },
    {
      id: "followup-datadog",
      key: "company-role:datadog:staff-ai-engineer",
      type: "followup",
      title: "Datadog - Staff AI Engineer follow-up",
      data: { company: "Datadog", score: 4.1, urgency: 9, ageDays: 10, sourceQuality: 1, status: "Applied", timelineState: "due" },
    },
    {
      id: "pipeline-acme",
      key: "url:https://example.test/jobs/acme",
      type: "pipeline",
      title: "Acme - AI Platform Engineer",
      data: { company: "Acme", score: 3.8, urgency: 4, ageDays: 5, sourceQuality: 0.8, status: "Pending" },
    },
    {
      id: "apply-anthropic-duplicate",
      key: "company-role:anthropic:solutions-architect",
      type: "apply",
      title: "Anthropic - Solutions Architect",
      data: { company: "Anthropic", score: 4.2, urgency: 7, ageDays: 1, sourceQuality: 1, status: "Evaluated" },
    },
    {
      id: "rejected-oldco",
      key: "company-role:oldco:platform-engineer",
      type: "followup",
      title: "OldCo - Platform Engineer",
      data: { company: "OldCo", score: 4.5, urgency: 10, ageDays: 20, sourceQuality: 1, status: "Rejected" },
    },
    {
      id: "duplicate-orbit",
      key: "company-role:orbit:agent-engineer",
      type: "apply",
      title: "Orbit - Agent Engineer",
      data: { company: "Orbit", score: 4.0, urgency: 6, ageDays: 3, sourceQuality: 1, status: "Evaluated", duplicate: true },
    },
  ];
}

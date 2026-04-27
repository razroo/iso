import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkTimeline,
  filterTimelineResult,
  loadTimelineConfig,
  planTimeline,
  timelineResultId,
  verifyTimelineResult,
} from "../src/index.js";

describe("iso-timeline", () => {
  it("plans due, overdue, upcoming, and suppressed actions", () => {
    const result = planTimeline(exampleConfig(), exampleEvents(), { now: "2026-04-27T00:00:00.000Z" });

    assert.equal(result.stats.total, 5);
    assert.equal(result.stats.overdue, 2);
    assert.equal(result.stats.due, 2);
    assert.equal(result.stats.suppressed, 1);
    assert.equal(result.stats.upcoming, 0);
    assert.equal(result.id, timelineResultId(result));
    assert.equal(verifyTimelineResult(result).ok, true);

    const orbit = result.items.find((item) => item.key.includes("orbit"));
    assert.equal(orbit?.state, "suppressed");
    assert.equal(orbit?.suppressedBy?.[0]?.type, "application.follow_up");
  });

  it("filters due queues and checks fail-on policy", () => {
    const result = planTimeline(exampleConfig(), exampleEvents(), { now: "2026-04-27T00:00:00.000Z" });
    const due = filterTimelineResult(result, ["due", "overdue"]);
    const overdueCheck = checkTimeline(exampleConfig(), exampleEvents(), {
      now: "2026-04-27T00:00:00.000Z",
      failOn: "overdue",
    });
    const noFailCheck = checkTimeline(exampleConfig(), exampleEvents(), {
      now: "2026-04-27T00:00:00.000Z",
      failOn: "none",
    });

    assert.equal(due.stats.total, 4);
    assert.equal(overdueCheck.ok, false);
    assert.equal(overdueCheck.errors, 2);
    assert.equal(noFailCheck.ok, true);
  });

  it("rejects invalid configs and results", () => {
    assert.throws(() => loadTimelineConfig({ version: 1, rules: [] }), /rules must be a non-empty array/);
    assert.throws(() => loadTimelineConfig({
      version: 1,
      rules: [{ id: "bad", action: "x", after: "soon" }],
    }), /must look like/);
    assert.equal(verifyTimelineResult({ schemaVersion: 1, id: "bad", items: [], stats: {} }).ok, false);
  });
});

function exampleConfig() {
  return {
    version: 1,
    defaults: { overdueAfter: "7d" },
    rules: [
      {
        id: "applied-follow-up",
        action: "send_follow_up",
        match: { type: "application.status", where: { "data.status": "Applied" } },
        after: "7d",
        suppressWhen: [{ type: ["application.follow_up", "application.rejected"] }],
      },
      {
        id: "thank-you",
        action: "send_thank_you",
        match: { type: "interview.completed" },
        after: "1d",
        overdueAfter: "2d",
        suppressWhen: [{ type: "interview.thank_you" }],
      },
      {
        id: "stale-pipeline",
        action: "process_or_discard",
        match: { type: "pipeline.item", where: { "data.status": "pending" } },
        after: "3d",
        overdueAfter: "1d",
      },
    ],
  };
}

function exampleEvents() {
  return [
    { id: "old-apply", key: "company-role:example:staff", type: "application.status", at: "2026-04-10T12:00:00.000Z", data: { status: "Applied" } },
    { id: "recent-apply", key: "company-role:acme:platform", type: "application.status", at: "2026-04-15T12:00:00.000Z", data: { status: "Applied" } },
    { id: "suppressed-apply", key: "company-role:orbit:agent", type: "application.status", at: "2026-04-20T12:00:00.000Z", data: { status: "Applied" } },
    { id: "follow-up", key: "company-role:orbit:agent", type: "application.follow_up", at: "2026-04-24T12:00:00.000Z" },
    { id: "interview", key: "company-role:nova:sa", type: "interview.completed", at: "2026-04-25T12:00:00.000Z" },
    { id: "pipeline", key: "url:https://example.test/jobs/123", type: "pipeline.item", at: "2026-04-21T09:00:00.000Z", data: { status: "pending" } },
  ];
}

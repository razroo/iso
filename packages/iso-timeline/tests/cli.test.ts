import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-timeline cli", () => {
  it("plans, filters due items, verifies, checks, and explains timelines", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-timeline-cli-"));
    const config = join(dir, "timeline.json");
    const events = join(dir, "events.jsonl");
    const out = join(dir, "timeline-result.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(events, `${exampleEvents().map((event) => JSON.stringify(event)).join("\n")}\n`);

    const plan = run(["plan", "--config", config, "--events", events, "--now", "2026-04-27T00:00:00.000Z", "--out", out]);
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /iso-timeline: PLAN/);
    assert.match(plan.stdout, /overdue=1/);

    const due = run(["due", "--config", config, "--events", events, "--now", "2026-04-27T00:00:00.000Z"]);
    assert.equal(due.status, 0, due.stderr);
    assert.match(due.stdout, /total=2/);

    const verify = run(["verify", "--timeline", out]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /PASS/);

    const check = run(["check", "--config", config, "--events", events, "--now", "2026-04-27T00:00:00.000Z"]);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /FAIL/);

    const checkNone = run(["check", "--config", config, "--events", events, "--now", "2026-04-27T00:00:00.000Z", "--fail-on", "none"]);
    assert.equal(checkNone.status, 0, checkNone.stderr);
    assert.match(checkNone.stdout, /PASS/);

    const explain = run(["explain", "--config", config]);
    assert.equal(explain.status, 0, explain.stderr);
    assert.match(explain.stdout, /iso-timeline config/);
  });
});

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
  });
}

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
      },
    ],
  };
}

function exampleEvents() {
  return [
    { id: "old", key: "company-role:example:staff", type: "application.status", at: "2026-04-10T12:00:00.000Z", data: { status: "Applied" } },
    { id: "recent", key: "company-role:acme:platform", type: "application.status", at: "2026-04-15T12:00:00.000Z", data: { status: "Applied" } },
  ];
}

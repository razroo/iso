import assert from "node:assert/strict";
import test from "node:test";

import { audit } from "../src/audit.js";
import type { GuardEvent, GuardPolicy } from "../src/types.js";

function policy(rules: GuardPolicy["rules"]): GuardPolicy {
  return { version: 1, rules };
}

test("max-per-group fails when a round exceeds the configured fan-out", () => {
  const result = audit(
    policy([
      {
        id: "H1",
        type: "max-per-group",
        match: { type: "tool_call", name: "task" },
        groupBy: "round",
        max: 2,
      },
    ]),
    [
      { type: "tool_call", name: "task", data: { round: 1 } },
      { type: "tool_call", name: "task", data: { round: 1 } },
      { type: "tool_call", name: "task", data: { round: 1 } },
      { type: "tool_call", name: "task", data: { round: 2 } },
    ],
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors, 1);
  assert.match(result.violations[0]?.message ?? "", /matched 3 event/);
});

test("require-before respects groupBy", () => {
  const p = policy([
    {
      id: "H3",
      type: "require-before",
      trigger: { type: "tool_call", name: "task" },
      require: { type: "tool_call", name: "geometra_disconnect" },
      groupBy: "round",
    },
  ]);

  const passing = audit(p, [
    { type: "tool_call", name: "geometra_disconnect", data: { round: 1 } },
    { type: "tool_call", name: "task", data: { round: 1 } },
  ]);
  assert.equal(passing.ok, true);

  const failing = audit(p, [
    { type: "tool_call", name: "geometra_disconnect", data: { round: 1 } },
    { type: "tool_call", name: "task", data: { round: 2 } },
  ]);
  assert.equal(failing.ok, false);
  assert.equal(failing.violations[0]?.details?.group, "2");
});

test("require-after requires follow-up events after the last trigger", () => {
  const result = audit(
    policy([
      {
        id: "H6",
        type: "require-after",
        ifAny: { type: "tool_call", name: "task", fields: { mode: "apply" } },
        require: [
          { type: "tool_call", name: "job-forge-merge" },
          { type: "tool_call", name: "job-forge-verify" },
        ],
      },
    ]),
    [
      { type: "tool_call", name: "task", data: { mode: "apply" } },
      { type: "tool_call", name: "job-forge-merge" },
    ],
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors, 1);
  assert.deepEqual(result.violations[0]?.details?.required, {
    type: "tool_call",
    name: "job-forge-verify",
  });
});

test("forbid-text checks text and structured data", () => {
  const result = audit(
    policy([
      {
        id: "H8",
        type: "forbid-text",
        match: { type: "tool_call", name: "task" },
        patterns: [{ source: "\\bpassword\\s*:", flags: "i" }],
      },
    ]),
    [
      {
        type: "tool_call",
        name: "task",
        text: "Proxy is configured; read config/profile.yml.",
        data: { prompt: "proxy: { password: secret }" },
      },
    ],
  );

  assert.equal(result.ok, false);
  assert.match(result.violations[0]?.message ?? "", /forbidden pattern/);
});

test("no-overlap catches duplicate active keys", () => {
  const events: GuardEvent[] = [
    { type: "task_start", data: { companyRole: "Acme|Engineer" } },
    { type: "task_start", data: { companyRole: "Acme|Engineer" } },
    { type: "task_end", data: { companyRole: "Acme|Engineer" } },
  ];

  const result = audit(
    policy([
      {
        id: "H5",
        type: "no-overlap",
        start: { type: "task_start" },
        end: { type: "task_end" },
        keyBy: "companyRole",
      },
    ]),
    events,
  );

  assert.equal(result.ok, false);
  assert.match(result.violations[0]?.message ?? "", /still active/);
});

test("warnings do not make result.ok false", () => {
  const result = audit(
    policy([
      {
        id: "advisory",
        type: "forbid-text",
        severity: "warn",
        patterns: ["slow"],
      },
    ]),
    [{ type: "message", text: "this is slow" }],
  );

  assert.equal(result.ok, true);
  assert.equal(result.warnings, 1);
});

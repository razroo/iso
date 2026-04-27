import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPreflightPlan, loadPreflightConfig, planPreflight } from "../src/index.js";
import type { PreflightConfig } from "../src/index.js";

const config: PreflightConfig = loadPreflightConfig({
  version: 1,
  workflows: [
    {
      name: "jobforge.apply",
      roundSize: 2,
      idFact: "id",
      conflictFact: "companyKey",
      requiredFacts: ["id", "company", "role", "companyRoleKey"],
      sourceRequiredFacts: ["company", "role", "companyRoleKey"],
      requireGateSources: true,
      preSteps: [{ id: "cleanup", label: "Cleanup", command: "npx cleanup" }],
      postSteps: [{ id: "verify", label: "Verify", command: "npx verify" }],
    },
  ],
});

describe("iso-preflight", () => {
  it("plans bounded rounds while avoiding same-conflict candidates in one round", () => {
    const result = planPreflight(config, {
      candidates: [
        readyCandidate("job-1", "company:a"),
        readyCandidate("job-2", "company:b"),
        readyCandidate("job-3", "company:a"),
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.totals.ready, 3);
    assert.deepEqual(result.rounds.map((round) => round.candidates.map((candidate) => candidate.id)), [
      ["job-1", "job-2"],
      ["job-3"],
    ]);
  });

  it("skips candidates with skip gates and keeps them out of rounds", () => {
    const result = planPreflight(config, {
      candidates: [
        readyCandidate("job-1", "company:a"),
        {
          facts: candidateFacts("job-2", "company:b"),
          gates: [{ id: "duplicate", status: "skip", reason: "already applied", source: ".index.json" }],
        },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.totals.ready, 1);
    assert.equal(result.totals.skipped, 1);
    assert.deepEqual(result.rounds.map((round) => round.candidates.map((candidate) => candidate.id)), [["job-1"]]);
    assert.match(formatPreflightPlan(result), /already applied @ \.index\.json/);
  });

  it("blocks missing source-backed facts and gate sources", () => {
    const result = planPreflight(config, {
      candidates: [
        {
          facts: {
            ...candidateFacts("job-1", "company:a"),
            companyRoleKey: { value: "company-role:a:role" },
          },
          gates: [{ id: "duplicate", status: "pass" }],
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.totals.blocked, 1);
    assert.deepEqual(result.blocked[0]?.issues.map((issue) => issue.kind), ["missing-source", "missing-source"]);
  });

  it("blocks explicit block gates", () => {
    const result = planPreflight(config, {
      candidates: [
        {
          facts: candidateFacts("job-1", "company:a"),
          gates: [{ id: "location", status: "block", reason: "location incompatible", source: "profile.yml" }],
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked[0]?.issues[0]?.message, "location incompatible");
  });
});

function readyCandidate(id: string, companyKey: string) {
  return {
    facts: candidateFacts(id, companyKey),
    gates: [{ id: "duplicate", status: "pass", source: ".index.json" }],
  };
}

function candidateFacts(id: string, companyKey: string) {
  return {
    id: { value: id, source: `reports/${id}.md:3` },
    company: { value: companyKey.split(":")[1], source: `reports/${id}.md:6` },
    role: { value: "Staff Engineer", source: `reports/${id}.md:7` },
    companyKey: { value: companyKey, source: "canon.json" },
    companyRoleKey: { value: `${companyKey.replace("company:", "company-role:")}:staff-engineer`, source: "canon.json" },
  };
}

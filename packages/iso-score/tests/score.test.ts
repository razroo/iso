import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkScore,
  compareScoreResults,
  computeScore,
  evaluateGate,
  loadScoreConfig,
  scoreResultId,
  verifyScoreResult,
} from "../src/index.js";

describe("iso-score", () => {
  it("computes weighted rubric scores with bands, gates, and stable ids", () => {
    const result = computeScore(exampleConfig(), exampleInput());

    assert.equal(result.profile, "jobfit");
    assert.equal(result.score, 3.95);
    assert.equal(result.normalized, 0.79);
    assert.equal(result.band?.id, "apply");
    assert.equal(result.gates.find((gate) => gate.id === "apply")?.pass, true);
    assert.equal(result.gates.find((gate) => gate.id === "strong")?.pass, false);
    assert.equal(result.issues.length, 0);
    assert.equal(result.id, scoreResultId(result));
    assert.equal(verifyScoreResult(result).ok, true);
  });

  it("fails checks and gates when required dimensions or evidence are missing", () => {
    const config = exampleConfig();
    const input = {
      subject: "Incomplete",
      dimensions: {
        role_fit: { score: 4.5, evidence: [] },
        company_fit: { score: 4, evidence: ["report.md:1"] },
      },
    };

    const check = checkScore(config, input);
    const gate = evaluateGate(config, input, { gate: "apply" });

    assert.equal(check.ok, false);
    assert.equal(gate.ok, false);
    assert.equal(check.errors, 2);
    assert.deepEqual(check.issues.map((issue) => issue.code).sort(), ["missing-evidence", "missing-required"]);
  });

  it("compares two score results deterministically", () => {
    const config = exampleConfig();
    const left = computeScore(config, exampleInput());
    const right = computeScore(config, {
      subject: "Lower score",
      dimensions: {
        role_fit: { score: 3, evidence: ["r.md:1"] },
        company_fit: { score: 3, evidence: ["r.md:2"] },
        location: { score: 3, evidence: ["r.md:3"] },
      },
    });

    const comparison = compareScoreResults(left, right);

    assert.equal(comparison.winner, "left");
    assert.equal(comparison.delta, 0.95);
    assert.match(comparison.reason, /left score is higher/);
  });

  it("rejects invalid configs", () => {
    assert.throws(() => loadScoreConfig({ version: 1, profiles: [] }), /profiles must be a non-empty array/);
    assert.throws(() => loadScoreConfig({
      version: 1,
      profiles: [{ name: "bad", dimensions: [{ id: "x", weight: 0 }] }],
    }), /weight must be a positive number/);
  });
});

function exampleConfig() {
  return loadScoreConfig({
    version: 1,
    profiles: [
      {
        name: "jobfit",
        scale: { min: 0, max: 5, precision: 2 },
        dimensions: [
          { id: "role_fit", label: "Role fit", weight: 0.4, required: true, minEvidence: 1 },
          { id: "company_fit", label: "Company fit", weight: 0.3, required: true, minEvidence: 1 },
          { id: "location", label: "Location", weight: 0.2, required: true, minEvidence: 1 },
          { id: "growth", label: "Growth", weight: 0.1, required: false, minEvidence: 1 },
        ],
        bands: [
          { id: "strong", min: 4 },
          { id: "apply", min: 3 },
          { id: "skip", min: 0 },
        ],
        gates: [
          { id: "apply", min: 3, blockOnMissingRequired: true, blockOnIssues: true },
          { id: "strong", min: 4, requireBand: "strong", blockOnIssues: true },
        ],
      },
    ],
  });
}

function exampleInput() {
  return {
    subject: "Example Labs Staff Agent Engineer",
    profile: "jobfit",
    dimensions: {
      role_fit: { score: 4.5, evidence: ["reports/001.md:12"] },
      company_fit: { score: 3.5, evidence: ["reports/001.md:18"] },
      location: { score: 4, evidence: ["reports/001.md:29"] },
      growth: { score: 3, evidence: ["reports/001.md:35"] },
    },
    facts: { url: "https://example.test/jobs/123" },
    meta: { report: "reports/001.md" },
  };
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-score cli", () => {
  it("computes, verifies, checks, gates, compares, and explains scores", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-score-cli-"));
    const config = join(dir, "score.json");
    const input = join(dir, "evaluation.json");
    const alt = join(dir, "evaluation-alt.json");
    const out = join(dir, "score-result.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(input, JSON.stringify(exampleInput(4.5), null, 2));
    writeFileSync(alt, JSON.stringify(exampleInput(3.2), null, 2));

    const compute = run(["compute", "--config", config, "--input", input, "--out", out]);
    assert.equal(compute.status, 0, compute.stderr);
    assert.match(compute.stdout, /iso-score: SCORED/);
    assert.match(compute.stdout, /score=4\.5\/5/);

    const verify = run(["verify", "--score", out]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /PASS/);

    const check = run(["check", "--config", config, "--input", input]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /iso-score: PASS/);

    const gate = run(["gate", "--config", config, "--input", input, "--gate", "apply"]);
    assert.equal(gate.status, 0, gate.stderr);
    assert.match(gate.stdout, /gate=apply/);

    const compare = run(["compare", "--config", config, "--left", input, "--right", alt]);
    assert.equal(compare.status, 0, compare.stderr);
    assert.match(compare.stdout, /WINNER left/);

    const explain = run(["explain", "--config", config]);
    assert.equal(explain.status, 0, explain.stderr);
    assert.match(explain.stdout, /iso-score config/);
  });

  it("check exits 1 for failing gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-score-cli-"));
    const config = join(dir, "score.json");
    const input = join(dir, "evaluation.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(input, JSON.stringify({ dimensions: { role_fit: { score: 2, evidence: ["r.md:1"] } } }, null, 2));

    const check = run(["check", "--config", config, "--input", input]);

    assert.equal(check.status, 1);
    assert.match(check.stdout, /FAIL/);
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
    profiles: [
      {
        name: "jobfit",
        scale: { min: 0, max: 5, precision: 2 },
        dimensions: [
          { id: "role_fit", weight: 0.5, required: true, minEvidence: 1 },
          { id: "location", weight: 0.5, required: true, minEvidence: 1 },
        ],
        bands: [
          { id: "strong", min: 4 },
          { id: "apply", min: 3 },
          { id: "skip", min: 0 },
        ],
        gates: [
          { id: "apply", min: 3, blockOnMissingRequired: true, blockOnIssues: true },
        ],
      },
    ],
  };
}

function exampleInput(score: number) {
  return {
    subject: "Example role",
    dimensions: {
      role_fit: { score, evidence: ["reports/001.md:12"] },
      location: { score, evidence: ["reports/001.md:29"] },
    },
  };
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-preflight cli", () => {
  it("prints a plan and exits cleanly when nothing is blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-preflight-cli-"));
    const config = join(dir, "preflight.json");
    const candidates = join(dir, "candidates.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(candidates, JSON.stringify({ candidates: [exampleCandidate("job-1")] }, null, 2));

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "plan", "--config", config, "--candidates", candidates], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /iso-preflight: PLAN workflow=jobforge.apply/);
    assert.match(result.stdout, /1\. job-1/);
  });

  it("check exits 1 when a candidate is blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-preflight-cli-"));
    const config = join(dir, "preflight.json");
    const candidates = join(dir, "candidates.json");
    const candidate = exampleCandidate("job-1");
    delete candidate.facts.company.source;
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(candidates, JSON.stringify({ candidates: [candidate] }, null, 2));

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "check", "--config", config, "--candidates", candidates], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /iso-preflight: FAIL/);
    assert.match(result.stdout, /fact "company" must include a source/);
  });
});

function exampleConfig() {
  return {
    version: 1,
    workflows: [
      {
        name: "jobforge.apply",
        roundSize: 2,
        idFact: "id",
        requiredFacts: ["id", "company"],
        sourceRequiredFacts: ["company"],
      },
    ],
  };
}

function exampleCandidate(id: string) {
  return {
    facts: {
      id: { value: id, source: "reports/001.md:3" },
      company: { value: "Example Labs", source: "reports/001.md:6" },
    },
  };
}

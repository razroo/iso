import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-prioritize cli", () => {
  it("ranks, selects, verifies, checks, and explains queues", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-prioritize-cli-"));
    const config = join(dir, "prioritize.json");
    const items = join(dir, "items.json");
    const out = join(dir, "prioritize-result.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(items, JSON.stringify({ items: exampleItems() }, null, 2));

    const rank = run(["rank", "--config", config, "--items", items, "--out", out]);
    assert.equal(rank.status, 0, rank.stderr);
    assert.match(rank.stdout, /iso-prioritize: RANK/);
    assert.match(rank.stdout, /selected=2/);

    const select = run(["select", "--config", config, "--items", items, "--limit", "1"]);
    assert.equal(select.status, 0, select.stderr);
    assert.match(select.stdout, /total=1/);

    const verify = run(["verify", "--result", out]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /PASS/);

    const check = run(["check", "--config", config, "--items", items, "--min-selected", "2"]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /PASS/);

    const checkFail = run(["check", "--config", config, "--items", items, "--limit", "1", "--min-selected", "2"]);
    assert.equal(checkFail.status, 1);
    assert.match(checkFail.stdout, /FAIL/);

    const explain = run(["explain", "--config", config]);
    assert.equal(explain.status, 0, explain.stderr);
    assert.match(explain.stdout, /iso-prioritize config/);
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
    defaults: { profile: "test", limit: 2 },
    profiles: [
      {
        name: "test",
        criteria: [
          { id: "score", field: "score", weight: 80, min: 0, max: 5 },
          { id: "urgency", field: "urgency", weight: 20, min: 0, max: 10 },
        ],
        gates: [
          { id: "skip", action: "skip", reason: "terminal", when: { where: { status: "Rejected" } } },
        ],
      },
    ],
  };
}

function exampleItems() {
  return [
    { id: "a", title: "A", data: { score: 4.5, urgency: 4, status: "Applied" } },
    { id: "b", title: "B", data: { score: 3.9, urgency: 10, status: "Pending" } },
    { id: "c", title: "C", data: { score: 5, urgency: 10, status: "Rejected" } },
  ];
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-facts cli", () => {
  it("builds, queries, verifies, and checks fact sets", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-facts-cli-"));
    mkdirSync(join(dir, "reports"), { recursive: true });
    const config = join(dir, "facts.json");
    const facts = join(dir, "facts.out.json");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(join(dir, "reports", "001.md"), [
      "**URL:** https://jobs.example.com/one",
      "**Score:** 3.8/5",
    ].join("\n"));

    const build = run(["build", "--config", config, "--root", dir, "--out", facts]);
    assert.equal(build.status, 0, build.stderr);
    assert.match(build.stdout, /iso-facts: BUILT 2 facts/);

    const query = run(["query", "--facts", facts, "--fact", "job.url"]);
    assert.equal(query.status, 0, query.stderr);
    assert.match(query.stdout, /job\.url/);

    const has = run(["has", "--facts", facts, "--fact", "job.score"]);
    assert.equal(has.status, 0, has.stderr);
    assert.match(has.stdout, /MATCH/);

    const verify = run(["verify", "--facts", facts]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /PASS/);

    const check = run(["check", "--facts", facts, "--config", config]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /PASS/);
  });

  it("check exits 1 for missing requirements", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-facts-cli-"));
    const config = join(dir, "facts.json");
    const facts = join(dir, "facts.out.json");
    writeFileSync(config, JSON.stringify({ version: 1, sources: [], requirements: [{ fact: "missing" }] }, null, 2));
    writeFileSync(facts, JSON.stringify({ schemaVersion: 1, root: dir, configHash: "x", stats: { sources: 0, files: 0, facts: 0 }, facts: [] }, null, 2));

    const check = run(["check", "--facts", facts, "--config", config]);

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
    sources: [
      {
        name: "reports",
        include: ["reports/*.md"],
        format: "text",
        rules: [
          {
            fact: "job.url",
            pattern: "^\\*\\*URL:\\*\\*\\s*(?<url>https?://\\S+)",
            key: "{url}",
            value: "{url}",
            fields: { url: "{url}" },
          },
          {
            fact: "job.score",
            pattern: "^\\*\\*Score:\\*\\*\\s*(?<score>[0-9.]+/5)",
            key: "{source}",
            value: "{score}",
            fields: { score: "{score}" },
          },
        ],
      },
    ],
    requirements: [
      { fact: "job.url" },
      { fact: "job.score" },
    ],
  };
}

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFacts,
  checkFactRequirements,
  formatFacts,
  hasFact,
  loadFactsConfig,
  queryFacts,
  verifyFactSet,
} from "../src/index.js";

describe("iso-facts", () => {
  it("extracts text, TSV, markdown-table, JSONL, and JSON facts with provenance", () => {
    const root = fixtureRoot();
    const config = exampleConfig();
    const factSet = buildFacts(config, { root });

    assert.equal(factSet.stats.sources, 5);
    assert.equal(factSet.stats.files, 5);
    assert.equal(factSet.stats.facts, 6);
    assert.equal(verifyFactSet(factSet).ok, true);

    const urls = queryFacts(factSet, { fact: "job.url" });
    assert.equal(urls.length, 1);
    assert.equal(urls[0]?.source.path, "reports/001-example.md");
    assert.equal(urls[0]?.source.line, 3);
    assert.equal(urls[0]?.value, "https://jobs.example.com/staff-ai-engineer");

    const scan = queryFacts(factSet, { fact: "job.scan" })[0];
    assert.equal(scan?.key, "example-co:staff-ai-engineer");
    assert.equal(scan?.fields.company, "Example Co");

    const candidate = queryFacts(factSet, { fact: "job.candidate" })[0];
    assert.equal(candidate?.source.pointer, "/candidates/0");
    assert.equal(candidate?.fields["location.status"], "compatible");

    assert.equal(hasFact(factSet, { fact: "job.outcome", key: "example-co:staff-ai-engineer" }), true);
    assert.match(formatFacts(queryFacts(factSet, { tag: "candidate" })), /job\.candidate/);
  });

  it("checks configured requirements", () => {
    const root = fixtureRoot();
    const factSet = buildFacts(exampleConfig(), { root });
    const pass = checkFactRequirements(factSet, [
      { fact: "job.url" },
      { fact: "job.score", min: 1 },
    ]);
    const fail = checkFactRequirements(factSet, [
      { fact: "job.missing", min: 1 },
    ]);

    assert.equal(pass.ok, true);
    assert.equal(fail.ok, false);
    assert.equal(fail.issues[0]?.kind, "missing-requirement");
  });

  it("rejects unknown source formats", () => {
    assert.throws(() => loadFactsConfig({
      version: 1,
      sources: [{ name: "bad", include: ["*.txt"], format: "yaml" }],
    }), /must be text, tsv, markdown-table, jsonl, or json/);
  });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "iso-facts-"));
  mkdirSync(join(root, "reports"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "batch"), { recursive: true });
  writeFileSync(join(root, "reports", "001-example.md"), [
    "# Example",
    "",
    "**URL:** https://jobs.example.com/staff-ai-engineer",
    "**Score:** 4.2/5",
    "",
    "| Company | Role | Status |",
    "| --- | --- | --- |",
    "| Example Co | Staff AI Engineer | Applied |",
  ].join("\n"));
  writeFileSync(join(root, "data", "scan-history.tsv"), [
    "date\tcompany\trole\turl\tats",
    "2026-04-27\tExample Co\tStaff AI Engineer\thttps://jobs.example.com/staff-ai-engineer\tgreenhouse",
  ].join("\n"));
  writeFileSync(join(root, "batch", "events.jsonl"), [
    JSON.stringify({ type: "jobforge.apply", data: { company: "Example Co", role: "Staff AI Engineer", status: "Applied" } }),
  ].join("\n"));
  writeFileSync(join(root, "batch", "preflight-candidates.json"), JSON.stringify({
    candidates: [
      {
        company: "Example Co",
        role: "Staff AI Engineer",
        url: "https://jobs.example.com/staff-ai-engineer",
        score: "4.2/5",
        location: { status: "compatible" },
      },
    ],
  }, null, 2));
  return root;
}

function exampleConfig() {
  return loadFactsConfig({
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
            flags: "i",
            key: "{url}",
            value: "{url}",
            fields: { url: "{url}", report: "{source}" },
            tags: ["report", "url"],
          },
          {
            fact: "job.score",
            pattern: "^\\*\\*Score:\\*\\*\\s*(?<score>[0-9.]+/5)",
            flags: "i",
            key: "{source}",
            value: "{score}",
            fields: { score: "{score}", report: "{source}" },
            tags: ["report", "score"],
          },
        ],
      },
      {
        name: "scan-history",
        include: ["data/scan-history.tsv"],
        format: "tsv",
        records: [
          {
            fact: "job.scan",
            key: "{company|slug}:{role|slug}",
            value: "{url}",
            fields: ["date", "company", "role", "url", "ats"],
            tags: ["scan"],
          },
        ],
      },
      {
        name: "tracker",
        include: ["reports/*.md"],
        format: "markdown-table",
        records: [
          {
            fact: "job.tracker-row",
            key: "{Company|slug}:{Role|slug}",
            value: "{Status}",
            fields: ["Company", "Role", "Status"],
            tags: ["tracker"],
          },
        ],
      },
      {
        name: "events",
        include: ["batch/events.jsonl"],
        format: "jsonl",
        records: [
          {
            fact: "job.outcome",
            key: "{data.company|slug}:{data.role|slug}",
            value: "{data.status}",
            fields: ["type", "data.company", "data.role", "data.status"],
            tags: ["event"],
          },
        ],
      },
      {
        name: "preflight",
        include: ["batch/preflight-candidates.json"],
        format: "json",
        records: [
          {
            fact: "job.candidate",
            path: "$.candidates[]",
            key: "{company|slug}:{role|slug}",
            value: "{url}",
            fields: ["company", "role", "url", "score", "location.status"],
            tags: ["candidate"],
          },
        ],
      },
    ],
  });
}

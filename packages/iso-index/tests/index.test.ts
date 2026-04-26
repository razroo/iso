import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildIndex,
  hasIndexRecord,
  loadIndexConfig,
  queryIndex,
  renderTemplate,
  verifyIndex,
} from "../src/index.js";
import { parseJson } from "../src/json.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(packageRoot, "examples", "jobforge-index.json");
const projectRoot = resolve(packageRoot, "examples", "jobforge-project");

function exampleConfig() {
  return loadIndexConfig(parseJson(readFileSync(configPath, "utf8"), configPath));
}

test("builds a deterministic JobForge-style artifact index", () => {
  const index = buildIndex(exampleConfig(), { root: projectRoot });

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.stats.sources, 4);
  assert.equal(index.stats.files, 4);
  assert.equal(index.records.length, 6);

  assert.ok(hasIndexRecord(index, {
    kind: "jobforge.application",
    key: "company-role:example-labs:staff-agent-engineer",
  }));

  const urlRecords = queryIndex(index, { key: "url:https://example.test/jobs/123" });
  assert.equal(urlRecords.length, 2);
  assert.deepEqual(urlRecords.map((record) => record.kind).sort(), [
    "jobforge.report.url",
    "jobforge.scan.url",
  ]);

  const score = queryIndex(index, { kind: "jobforge.report.score" });
  assert.equal(score[0]?.value, "4.2/5");
  assert.equal(score[0]?.fields.score, "4.2/5");
});

test("verifies record ids and catches tampering", () => {
  const index = buildIndex(exampleConfig(), { root: projectRoot });
  assert.equal(verifyIndex(index).ok, true);

  const tampered = structuredClone(index);
  tampered.records[0]!.key = "changed";
  const result = verifyIndex(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.kind, "record-id");
});

test("template filters support stable lookup keys", () => {
  assert.equal(
    renderTemplate("company-role:{Company|slug}:{Role|slug}", {
      Company: "Example Labs",
      Role: "Staff Agent Engineer",
    }),
    "company-role:example-labs:staff-agent-engineer",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  getContract,
  loadContractCatalog,
  parseRecord,
  renderRecord,
  validateRecord,
} from "../src/index.js";
import type { ContractDefinition } from "../src/index.js";

const trackerContract: ContractDefinition = {
  name: "jobforge.tracker-row",
  fields: [
    { name: "num", type: "integer", required: true, min: 1 },
    { name: "date", type: "date", required: true },
    { name: "company", type: "string", required: true },
    { name: "role", type: "string", required: true },
    { name: "status", type: "enum", required: true, values: ["Evaluated", "Applied", "SKIP"] },
    { name: "score", type: "score", required: true },
    { name: "report", type: "markdown-link", required: true },
    { name: "notes", type: "string" },
  ],
  formats: {
    tsv: {
      style: "delimited",
      delimiter: "tab",
      fields: ["num", "date", "company", "role", "status", "score", "report", "notes"],
    },
    markdown: {
      style: "markdown-table-row",
      fields: ["num", "date", "company", "role", "score", "status", "report", "notes"],
    },
  },
};

test("loads a catalog and validates records", () => {
  const catalog = loadContractCatalog({ contracts: [trackerContract] });
  const contract = getContract(catalog, "jobforge.tracker-row");
  const result = validateRecord(contract, {
    num: "812",
    date: "2026-04-26",
    company: " Example Labs ",
    role: "Staff Agent Engineer",
    status: "Applied",
    score: "4.2/5",
    report: "[812](reports/812-example-labs-2026-04-26.md)",
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.num, 812);
  assert.equal(result.record.company, "Example Labs");
});

test("reports validation errors and unknown field warnings", () => {
  const result = validateRecord(trackerContract, {
    num: 0,
    date: "26-04-2026",
    company: "Example Labs",
    role: "Staff Agent Engineer",
    status: "Done",
    score: "7/5",
    report: "reports/812.md",
    extra: "kept",
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors, 5);
  assert.equal(result.warnings, 1);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "below-min",
    "invalid-date",
    "invalid-enum",
    "invalid-score",
    "invalid-markdown-link",
    "unknown-field",
  ]);
});

test("renders and parses TSV rows", () => {
  const record = {
    num: 812,
    date: "2026-04-26",
    company: "Example Labs",
    role: "Staff Agent Engineer",
    status: "Applied",
    score: "4.2/5",
    report: "[812](reports/812-example-labs-2026-04-26.md)",
    notes: "Submitted",
  };

  const rendered = renderRecord(trackerContract, record, "tsv");
  assert.equal(rendered.validation.ok, true);
  assert.equal(
    rendered.text,
    "812\t2026-04-26\tExample Labs\tStaff Agent Engineer\tApplied\t4.2/5\t[812](reports/812-example-labs-2026-04-26.md)\tSubmitted",
  );

  const parsed = parseRecord(trackerContract, rendered.text, "tsv");
  assert.equal(parsed.validation.ok, true);
  assert.equal(parsed.record.num, 812);
  assert.equal(parsed.record.status, "Applied");
});

test("renders and parses markdown table rows", () => {
  const row = "| 812 | 2026-04-26 | Example Labs | Staff Agent Engineer | 4.2/5 | Applied | [812](reports/812-example-labs-2026-04-26.md) | Submitted |";
  const parsed = parseRecord(trackerContract, row, "markdown");

  assert.equal(parsed.validation.ok, true);
  assert.equal(parsed.record.company, "Example Labs");

  const rendered = renderRecord(trackerContract, parsed.record, "markdown");
  assert.equal(rendered.text, row);
});

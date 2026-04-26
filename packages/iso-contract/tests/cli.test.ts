import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";

function withConsole(run: (lines: string[], errors: string[]) => void): void {
  const oldLog = console.log;
  const oldError = console.error;
  const lines: string[] = [];
  const errors: string[] = [];
  console.log = (line?: unknown) => { lines.push(String(line ?? "")); };
  console.error = (line?: unknown) => { errors.push(String(line ?? "")); };
  try {
    run(lines, errors);
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}

function withFixture(run: (contracts: string, record: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-contract-cli-"));
  try {
    const contracts = join(dir, "contracts.json");
    const record = join(dir, "record.json");
    writeFileSync(contracts, JSON.stringify({
      contracts: [
        {
          name: "jobforge.tracker-row",
          fields: [
            { name: "num", type: "integer", required: true, min: 1 },
            { name: "date", type: "date", required: true },
            { name: "company", type: "string", required: true },
            { name: "role", type: "string", required: true },
            { name: "status", type: "enum", required: true, values: ["Evaluated", "Applied"] },
            { name: "score", type: "score", required: true },
          ],
          formats: {
            tsv: {
              style: "delimited",
              delimiter: "tab",
              fields: ["num", "date", "company", "role", "status", "score"],
            },
          },
        },
      ],
    }), "utf8");
    writeFileSync(record, JSON.stringify({
      num: 812,
      date: "2026-04-26",
      company: "Example Labs",
      role: "Staff Agent Engineer",
      status: "Applied",
      score: "4.2/5",
    }), "utf8");
    run(contracts, record);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI lists, validates, renders, and parses", () => {
  withFixture((contracts, record) => {
    withConsole((lines) => {
      const code = main(["list", "--contracts", contracts]);
      assert.equal(code, 0);
      assert.equal(lines.join("\n"), "jobforge.tracker-row");
    });

    withConsole((lines) => {
      const code = main(["validate", "jobforge.tracker-row", "--contracts", contracts, "--input", `@${record}`]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS jobforge\.tracker-row/);
    });

    let tsv = "";
    withConsole((lines) => {
      const code = main(["render", "jobforge.tracker-row", "--contracts", contracts, "--input", `@${record}`, "--format", "tsv"]);
      assert.equal(code, 0);
      tsv = lines.join("\n");
      assert.match(tsv, /^812\t2026-04-26\tExample Labs/);
    });

    withConsole((lines) => {
      const code = main(["parse", "jobforge.tracker-row", "--contracts", contracts, "--format", "tsv", "--input", tsv]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /"status": "Applied"/);
    });
  });
});

test("CLI exits non-zero on invalid records", () => {
  withFixture((contracts) => {
    withConsole((lines) => {
      const code = main([
        "validate",
        "jobforge.tracker-row",
        "--contracts",
        contracts,
        "--input",
        '{"num":0,"date":"bad","company":"A","role":"B","status":"Done","score":"9/5"}',
      ]);
      assert.equal(code, 1);
      assert.match(lines.join("\n"), /FAIL jobforge\.tracker-row/);
    });
  });
});

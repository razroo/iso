import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../src/cli.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(packageRoot, "examples", "jobforge-index.json");
const projectRoot = resolve(packageRoot, "examples", "jobforge-project");

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

function withTmp(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-index-cli-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI builds, queries, checks, and verifies an index", () => {
  withTmp((dir) => {
    const out = join(dir, ".iso-index.json");

    withConsole((lines) => {
      const code = main(["build", "--config", configPath, "--root", projectRoot, "--out", out]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /BUILT 6 records/);
    });

    const stored = JSON.parse(readFileSync(out, "utf8")) as { records: unknown[] };
    assert.equal(stored.records.length, 6);

    withConsole((lines) => {
      const code = main([
        "query",
        "--index",
        out,
        "--key",
        "company-role:example-labs:staff-agent-engineer",
      ]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /jobforge.application/);
      assert.match(lines.join("\n"), /Applied/);
    });

    withConsole((lines) => {
      const code = main(["has", "--index", out, "example labs"]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /MATCH/);
    });

    withConsole((lines) => {
      const code = main(["verify", "--index", out]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS/);
    });
  });
});

test("CLI reports usage errors", () => {
  withConsole((_lines, errors) => {
    const code = main(["build"]);
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /--config is required/);
  });
});

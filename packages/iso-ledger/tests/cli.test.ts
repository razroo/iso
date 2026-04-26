import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

function withTempLedger(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-ledger-cli-"));
  try {
    run(join(dir, "events.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI appends, queries, and verifies a ledger", () => {
  withTempLedger((path) => {
    withConsole((lines) => {
      const code = main([
        "append",
        "application.submitted",
        "--ledger",
        path,
        "--key",
        "url:https://example.test/job/1",
        "--subject",
        "job:example:engineer",
        "--idempotency-key",
        "apply:https://example.test/job/1",
        "--at",
        "2026-04-26T00:00:00.000Z",
        "--data",
        '{"status":"applied"}',
      ]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /APPENDED/);
    });

    withConsole((lines) => {
      const code = main(["query", "--ledger", path, "--where", "status=applied"]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /application\.submitted/);
    });

    withConsole((lines) => {
      const code = main(["verify", "--ledger", path]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS/);
    });
  });
});

test("CLI has exits 1 for a miss and 0 for a hit", () => {
  withTempLedger((path) => {
    withConsole(() => {
      assert.equal(main([
        "append",
        "scan.found",
        "--ledger",
        path,
        "--key",
        "url:a",
        "--at",
        "2026-04-26T00:00:00.000Z",
      ]), 0);
      assert.equal(main(["has", "--ledger", path, "--key", "url:a"]), 0);
      assert.equal(main(["has", "--ledger", path, "--key", "url:b"]), 1);
    });
  });
});

test("CLI reports usage errors", () => {
  withConsole((_lines, errors) => {
    const code = main(["append"]);
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /missing <type>/);
  });
});

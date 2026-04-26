import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function withCache(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-cache-cli-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI keys, stores, reads, lists, and verifies entries", () => {
  withCache((dir) => {
    const cacheDir = join(dir, ".iso-cache");
    const inputPath = join(dir, "jd.md");
    writeFileSync(inputPath, "# Example\n", "utf8");

    withConsole((lines) => {
      const code = main(["key", "--namespace", "jd", "--part", "https://example.test/jobs/123"]);
      assert.equal(code, 0);
      assert.match(lines[0] || "", /^jd:[a-f0-9]{64}$/);
    });

    withConsole((lines) => {
      const code = main([
        "put",
        "jd:example",
        "--cache",
        cacheDir,
        "--kind",
        "jd",
        "--ttl",
        "7d",
        "--meta",
        '{"url":"https://example.test/jobs/123"}',
        "--input",
        `@${inputPath}`,
      ]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /STORED/);
    });

    withConsole((lines) => {
      assert.equal(main(["has", "jd:example", "--cache", cacheDir]), 0);
      assert.match(lines.join("\n"), /HIT/);
    });

    withConsole((lines) => {
      assert.equal(main(["get", "jd:example", "--cache", cacheDir]), 0);
      assert.equal(lines.join("\n"), "# Example\n");
    });

    withConsole((lines) => {
      assert.equal(main(["list", "--cache", cacheDir, "--kind", "jd"]), 0);
      assert.match(lines.join("\n"), /jd:example/);
    });

    withConsole((lines) => {
      assert.equal(main(["verify", "--cache", cacheDir]), 0);
      assert.match(lines.join("\n"), /PASS/);
    });
  });
});

test("CLI get can write output and miss exits 1", () => {
  withCache((dir) => {
    const cacheDir = join(dir, ".iso-cache");
    const outPath = join(dir, "out.txt");
    withConsole(() => {
      assert.equal(main(["put", "key", "--cache", cacheDir, "--input", "value"]), 0);
      assert.equal(main(["get", "key", "--cache", cacheDir, "--output", outPath]), 0);
      assert.equal(readFileSync(outPath, "utf8"), "value");
      assert.equal(main(["get", "missing", "--cache", cacheDir]), 1);
    });
  });
});

test("CLI reports usage errors", () => {
  withConsole((_lines, errors) => {
    const code = main(["put", "key"]);
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /--input is required/);
  });
});

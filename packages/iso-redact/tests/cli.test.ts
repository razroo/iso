import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-redact cli", () => {
  it("scan reports findings and exits cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-redact-cli-"));
    const config = join(dir, "redact.json");
    const input = join(dir, "input.txt");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(input, "email: charlie@example.com\n");

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "scan", "--config", config, "--input", input], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /iso-redact: FOUND/);
    assert.match(result.stdout, /email: 1/);
  });

  it("verify exits 1 when values are still present", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-redact-cli-"));
    const config = join(dir, "redact.json");
    const input = join(dir, "input.txt");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(input, "password=hunter2\n");

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "verify", "--config", config, "--input", input], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /iso-redact: FAIL/);
    assert.doesNotMatch(result.stdout, /hunter2/);
  });

  it("apply writes redacted output", () => {
    const dir = mkdtempSync(join(tmpdir(), "iso-redact-cli-"));
    const config = join(dir, "redact.json");
    const input = join(dir, "input.txt");
    const output = join(dir, "output.txt");
    writeFileSync(config, JSON.stringify(exampleConfig(), null, 2));
    writeFileSync(input, "password=\"hunter2\"\n");

    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, "apply", "--config", config, "--input", input, "--output", output], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /password="\[REDACTED:secret-field\]"/);
  });
});

function exampleConfig() {
  return {
    version: 1,
    builtins: ["email"],
    fields: [{ id: "secret-field", names: ["password"] }],
  };
}

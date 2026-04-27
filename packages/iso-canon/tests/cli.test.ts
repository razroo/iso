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

function withConfig(run: (configPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-canon-cli-"));
  try {
    const configPath = join(dir, "canon.json");
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      profiles: [
        {
          name: "jobforge",
          company: { aliases: { "open ai": "openai" } },
          role: { aliases: { swe: "software engineer" }, stopWords: ["remote", "us"] },
        },
      ],
    }, null, 2));
    run(configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI normalizes values and prints keys", () => {
  withConfig((configPath) => {
    withConsole((lines) => {
      const code = main(["normalize", "company", "Open AI", "--config", configPath, "--profile", "jobforge"]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /company:openai/);
    });

    withConsole((lines) => {
      const code = main([
        "key",
        "company-role",
        "--company",
        "OpenAI, Inc.",
        "--role",
        "Senior SWE - Remote US",
        "--config",
        configPath,
        "--profile",
        "jobforge",
      ]);
      assert.equal(code, 0);
      assert.equal(lines.join("\n"), "company-role:openai:senior-software-engineer");
    });
  });
});

test("CLI compares values and explains config", () => {
  withConfig((configPath) => {
    withConsole((lines) => {
      const code = main(["compare", "company", "OpenAI, Inc.", "Open AI", "--config", configPath, "--profile", "jobforge"]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /SAME score=1/);
    });

    withConsole((lines) => {
      const code = main(["explain", "--config", configPath, "--profile", "jobforge"]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /iso-canon config: 1 profile/);
      assert.match(lines.join("\n"), /jobforge/);
    });
  });
});

test("CLI reports usage errors", () => {
  withConsole((_lines, errors) => {
    const code = main(["normalize", "company", "OpenAI", "extra"]);
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /provide exactly one value/);
  });
});

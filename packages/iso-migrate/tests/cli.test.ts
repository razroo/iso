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

function withProject(run: (dir: string, configPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-migrate-cli-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: {}, dependencies: {} }, null, 2) + "\n");
    const configPath = join(dir, "migrations.json");
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      migrations: [
        {
          id: "add-script",
          operations: [
            {
              type: "json-merge",
              path: "package.json",
              pointer: "/scripts",
              value: { "index:status": "job-forge index:status" },
            },
            {
              type: "ensure-lines",
              path: ".gitignore",
              lines: [".jobforge-index.json"],
            },
          ],
        },
      ],
    }, null, 2));
    run(dir, configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI plans, applies, checks, and explains migrations", () => {
  withProject((dir, configPath) => {
    withConsole((lines) => {
      const code = main(["plan", "--config", configPath, "--root", dir]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PLAN 2 change/);
    });

    withConsole((lines) => {
      const code = main(["check", "--config", configPath, "--root", dir]);
      assert.equal(code, 1);
      assert.match(lines.join("\n"), /PENDING 2 change/);
    });

    withConsole((lines) => {
      const code = main(["apply", "--config", configPath, "--root", dir]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /APPLIED 2 change/);
    });
    assert.match(readFileSync(join(dir, "package.json"), "utf8"), /index:status/);

    withConsole((lines) => {
      const code = main(["check", "--config", configPath, "--root", dir]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS 0 change/);
    });

    withConsole((lines) => {
      const code = main(["explain", "--config", configPath]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /add-script/);
    });
  });
});

test("CLI reports usage errors", () => {
  withConsole((_lines, errors) => {
    const code = main(["plan"]);
    assert.equal(code, 2);
    assert.match(errors.join("\n"), /--config is required/);
  });
});

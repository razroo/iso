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

function withFixture(run: (policyPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-capabilities-cli-"));
  try {
    const policyPath = join(dir, "capabilities.json");
    writeFileSync(policyPath, JSON.stringify({
      roles: [
        {
          name: "orchestrator",
          tools: ["read", "task"],
          commands: {
            allow: ["npx job-forge verify"],
            deny: ["rm -rf *"],
          },
          filesystem: "read-only",
          network: "off",
        },
        {
          name: "applicant",
          extends: "orchestrator",
          tools: ["browser"],
          mcp: ["geometra"],
          commands: {
            allow: ["npx job-forge merge"],
          },
          filesystem: "project-write",
          network: "restricted",
        },
      ],
    }), "utf8");
    run(policyPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI lists, explains, checks, and renders roles", () => {
  withFixture((policyPath) => {
    withConsole((lines) => {
      const code = main(["list", "--policy", policyPath]);
      assert.equal(code, 0);
      assert.equal(lines.join("\n"), "applicant\norchestrator");
    });

    withConsole((lines) => {
      const code = main(["explain", "applicant", "--policy", policyPath]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /filesystem: project-write/);
      assert.match(lines.join("\n"), /mcp: geometra/);
    });

    withConsole((lines) => {
      const code = main([
        "check",
        "applicant",
        "--policy",
        policyPath,
        "--tool",
        "browser",
        "--mcp",
        "geometra",
        "--command",
        "npx job-forge merge",
        "--filesystem",
        "write",
        "--network",
        "restricted",
      ]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS applicant/);
    });

    withConsole((lines) => {
      const code = main(["render", "applicant", "--policy", policyPath, "--target", "opencode"]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /Target: opencode/);
      assert.match(lines.join("\n"), /MCP servers: geometra/);
    });
  });
});

test("CLI exits non-zero when a request violates policy", () => {
  withFixture((policyPath) => {
    withConsole((lines) => {
      const code = main([
        "check",
        "applicant",
        "--policy",
        policyPath,
        "--command",
        "rm -rf data",
      ]);
      assert.equal(code, 1);
      assert.match(lines.join("\n"), /FAIL applicant/);
      assert.match(lines.join("\n"), /command-denied/);
    });
  });
});

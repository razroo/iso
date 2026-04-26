import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function withFixture(run: (dir: string, policyPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-context-cli-"));
  try {
    mkdirSync(join(dir, "iso"), { recursive: true });
    mkdirSync(join(dir, "modes"), { recursive: true });
    writeFileSync(join(dir, "iso", "instructions.md"), "base instructions\n", "utf8");
    writeFileSync(join(dir, "modes", "apply.md"), "apply mode\n", "utf8");
    const policyPath = join(dir, "context.json");
    writeFileSync(policyPath, JSON.stringify({
      defaults: { tokenBudget: 100, charsPerToken: 4 },
      bundles: [
        {
          name: "base",
          files: ["iso/instructions.md"],
        },
        {
          name: "apply",
          extends: "base",
          files: [
            "modes/apply.md",
            { path: "modes/reference-geometra.md", required: false },
          ],
        },
      ],
    }), "utf8");
    run(dir, policyPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI lists, explains, plans, checks, and renders bundles", () => {
  withFixture((dir, policyPath) => {
    withConsole((lines) => {
      const code = main(["list", "--policy", policyPath]);
      assert.equal(code, 0);
      assert.equal(lines.join("\n"), "apply\nbase");
    });

    withConsole((lines) => {
      const code = main(["explain", "apply", "--policy", policyPath]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /extends: base/);
      assert.match(lines.join("\n"), /modes\/apply\.md/);
    });

    withConsole((lines) => {
      const code = main(["plan", "apply", "--policy", policyPath, "--root", dir]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS apply/);
      assert.match(lines.join("\n"), /2\/3 files/);
    });

    withConsole((lines) => {
      const code = main(["check", "apply", "--policy", policyPath, "--root", dir]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /PASS apply/);
    });

    withConsole((lines) => {
      const code = main(["render", "apply", "--policy", policyPath, "--root", dir]);
      assert.equal(code, 0);
      assert.match(lines.join("\n"), /# iso-context bundle: apply/);
      assert.match(lines.join("\n"), /base instructions/);
    });
  });
});

test("CLI check exits non-zero when a bundle violates budget", () => {
  withFixture((dir, policyPath) => {
    withConsole((lines) => {
      const code = main(["check", "apply", "--policy", policyPath, "--root", dir, "--budget", "1"]);
      assert.equal(code, 1);
      assert.match(lines.join("\n"), /FAIL apply/);
      assert.match(lines.join("\n"), /bundle-over-budget/);
    });
  });
});

/**
 * CLI integration: linting a subdirectory must still resolve cross-references
 * (links, file mentions, path-gated rules) against the repo root, not against
 * the subdirectory itself.
 *
 * Regression: `isolint lint modes/` previously made `cwd` the target dir, so
 * `discoverRepoFiles` only saw files under `modes/` and `[..](../X.md)` links
 * to project-root files were always flagged stale-link-reference. Same
 * mis-rooting also stripped the `modes/` prefix from `ctx.file`, silently
 * disabling every rule that gates on path prefixes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "..", "src", "cli", "index.ts");
const TSX = resolve(HERE, "..", "node_modules", ".bin", "tsx");

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "isolint-cli-subdir-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.co"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  return root;
}

function runCli(cwd: string, args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("CLI: linting a subdirectory resolves paths against the repo root", () => {
  it("does not flag ../X.md links pointing to a project-root file", () => {
    const root = makeRepo();
    mkdirSync(join(root, "modes"));
    writeFileSync(join(root, "CONTRIBUTING.md"), "# contributing\n");
    writeFileSync(
      join(root, "modes", "README.md"),
      "Contributors: see [CONTRIBUTING.md](../CONTRIBUTING.md).\n",
    );
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });

    const { stdout } = runCli(root, ["lint", "modes/"]);
    assert.ok(
      !stdout.includes("stale-link-reference"),
      `expected no stale-link-reference, got:\n${stdout}`,
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverFiles, discoverRepoFiles } from "../src/lint/scanner.js";

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "isolint-gitignore-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.co"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  return root;
}

describe("scanner gitignore integration", () => {
  it("skips .gitignored files and directories by default", () => {
    const root = makeRepo();
    writeFileSync(join(root, ".gitignore"), "generated.md\nbuild/\n");
    writeFileSync(join(root, "src.md"), "# src\n");
    writeFileSync(join(root, "generated.md"), "# gen\n");
    mkdirSync(join(root, "build"));
    writeFileSync(join(root, "build", "out.md"), "# out\n");

    const files = discoverFiles(root, { include_ext: [".md"], ignore: [] });
    assert.deepEqual(
      files.map((f) => f.rel_path).sort(),
      ["src.md"],
    );

    const repo = discoverRepoFiles(root, { ignore: [] });
    assert.ok(repo.has("src.md"));
    assert.ok(repo.has(".gitignore"));
    assert.ok(!repo.has("generated.md"));
    assert.ok(!repo.has("build/out.md"));
  });

  it("honors --no-gitignore opt-out", () => {
    const root = makeRepo();
    writeFileSync(join(root, ".gitignore"), "generated.md\n");
    writeFileSync(join(root, "src.md"), "# src\n");
    writeFileSync(join(root, "generated.md"), "# gen\n");

    const files = discoverFiles(root, {
      include_ext: [".md"],
      ignore: [],
      use_gitignore: false,
    });
    assert.deepEqual(
      files.map((f) => f.rel_path).sort(),
      ["generated.md", "src.md"],
    );
  });

  it("works in directories that are not git repos", () => {
    const root = mkdtempSync(join(tmpdir(), "isolint-no-git-"));
    writeFileSync(join(root, "a.md"), "# a\n");
    writeFileSync(join(root, "b.md"), "# b\n");
    const files = discoverFiles(root, { include_ext: [".md"], ignore: [] });
    assert.deepEqual(
      files.map((f) => f.rel_path).sort(),
      ["a.md", "b.md"],
    );
  });

  it("still applies explicit ignore globs on top of gitignore", () => {
    const root = makeRepo();
    writeFileSync(join(root, ".gitignore"), "gen.md\n");
    writeFileSync(join(root, "a.md"), "# a\n");
    writeFileSync(join(root, "b.md"), "# b\n");
    writeFileSync(join(root, "gen.md"), "# gen\n");

    const files = discoverFiles(root, {
      include_ext: [".md"],
      ignore: ["a.md"],
    });
    assert.deepEqual(
      files.map((f) => f.rel_path).sort(),
      ["b.md"],
    );
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const CLI = join(process.cwd(), "src/cli.ts");

describe("iso-lineage cli", () => {
  it("records, verifies, checks, lists stale artifacts, and explains graphs", () => {
    const root = fixture();
    const graph = join(root, ".iso-lineage.json");

    const recordReport = run([
      "record",
      "--root",
      root,
      "--graph",
      graph,
      "--artifact",
      "reports/report.md",
      "--input",
      "cv.md",
      "--input",
      "profile.yml",
      "--command",
      "job-forge evaluate",
    ]);
    assert.equal(recordReport.status, 0, recordReport.stderr);
    assert.match(recordReport.stdout, /iso-lineage: RECORDED/);

    const recordPdf = run([
      "record",
      "--root",
      root,
      "--graph",
      graph,
      "--artifact",
      "generated/report.pdf",
      "--input",
      "reports/report.md",
    ]);
    assert.equal(recordPdf.status, 0, recordPdf.stderr);

    const verify = run(["verify", "--graph", graph]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /PASS/);

    const check = run(["check", "--root", root, "--graph", graph]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /PASS/);

    writeFileSync(join(root, "cv.md"), "# CV\n\nChanged.\n");
    const checkFail = run(["check", "--root", root, "--graph", graph]);
    assert.equal(checkFail.status, 1);
    assert.match(checkFail.stdout, /STALE/);

    const stale = run(["stale", "--root", root, "--graph", graph]);
    assert.equal(stale.status, 0, stale.stderr);
    assert.match(stale.stdout, /stale-upstream|input-hash-changed/);

    const explain = run(["explain", "--root", root, "--graph", graph, "--artifact", "reports/report.md"]);
    assert.equal(explain.status, 0, explain.stderr);
    assert.match(explain.stdout, /iso-lineage graph/);
    assert.match(explain.stdout, /reports\/report\.md/);
  });
});

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    cwd: join(process.cwd()),
    encoding: "utf8",
  });
}

function fixture(): string {
  const root = join(tmpdir(), `iso-lineage-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "reports"), { recursive: true });
  mkdirSync(join(root, "generated"), { recursive: true });
  writeFileSync(join(root, "cv.md"), "# CV\n");
  writeFileSync(join(root, "profile.yml"), "name: Example\n");
  writeFileSync(join(root, "reports", "report.md"), "# Report\n");
  writeFileSync(join(root, "generated", "report.pdf"), "PDF\n");
  return root;
}

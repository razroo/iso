import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkLineage,
  emptyLineageGraph,
  recordLineage,
  verifyLineageGraph,
} from "../src/index.js";

describe("iso-lineage", () => {
  it("records artifacts and detects changed inputs", () => {
    const root = fixture();
    let graph = emptyLineageGraph();
    graph = recordLineage(graph, {
      root,
      artifact: "reports/report.md",
      inputs: ["cv.md", "profile.yml", "jobs/job.md"],
      command: "job-forge evaluate jobs/job.md",
      now: "2026-04-27T00:00:00.000Z",
    });

    assert.equal(graph.records.length, 1);
    assert.equal(verifyLineageGraph(graph).ok, true);
    assert.equal(checkLineage(graph, { root }).ok, true);

    writeFileSync(join(root, "cv.md"), "# CV\n\nChanged profile.\n");
    const changed = checkLineage(graph, { root });
    assert.equal(changed.ok, false);
    assert.equal(changed.stale, 1);
    assert.match(changed.issues.map((issue) => issue.code).join(","), /input-hash-changed/);
  });

  it("propagates stale state through generated artifacts", () => {
    const root = fixture();
    let graph = emptyLineageGraph();
    graph = recordLineage(graph, {
      root,
      artifact: "reports/report.md",
      inputs: ["cv.md", "profile.yml", "jobs/job.md"],
    });
    graph = recordLineage(graph, {
      root,
      artifact: "generated/report.pdf",
      inputs: ["reports/report.md"],
    });

    writeFileSync(join(root, "profile.yml"), "name: Updated\n");
    const result = checkLineage(graph, { root });
    const report = result.records.find((record) => record.record.artifact.path === "reports/report.md");
    const pdf = result.records.find((record) => record.record.artifact.path === "generated/report.pdf");

    assert.equal(result.ok, false);
    assert.equal(report?.state, "stale");
    assert.equal(pdf?.state, "stale");
    assert.match(pdf?.issues.map((issue) => issue.code).join(",") || "", /stale-upstream/);
  });

  it("propagates stale state transitively regardless of record sort order", () => {
    const root = fixture();
    mkdirSync(join(root, "a"), { recursive: true });
    mkdirSync(join(root, "m"), { recursive: true });
    mkdirSync(join(root, "z"), { recursive: true });
    writeFileSync(join(root, "seed.txt"), "seed\n");
    writeFileSync(join(root, "z", "source.md"), "source\n");
    writeFileSync(join(root, "m", "report.md"), "report\n");
    writeFileSync(join(root, "a", "final.pdf"), "pdf\n");

    let graph = emptyLineageGraph();
    graph = recordLineage(graph, {
      root,
      artifact: "z/source.md",
      inputs: ["seed.txt"],
    });
    graph = recordLineage(graph, {
      root,
      artifact: "m/report.md",
      inputs: ["z/source.md"],
    });
    graph = recordLineage(graph, {
      root,
      artifact: "a/final.pdf",
      inputs: ["m/report.md"],
    });

    writeFileSync(join(root, "seed.txt"), "changed\n");
    const result = checkLineage(graph, { root });
    const final = result.records.find((record) => record.record.artifact.path === "a/final.pdf");

    assert.equal(final?.state, "stale");
    assert.match(final?.issues.map((issue) => issue.code).join(",") || "", /stale-upstream/);
  });

  it("detects optional inputs that appear after recording", () => {
    const root = fixture();
    let graph = emptyLineageGraph();
    graph = recordLineage(graph, {
      root,
      artifact: "reports/report.md",
      inputs: ["cv.md"],
      optionalInputs: ["portfolio.md"],
    });

    assert.equal(checkLineage(graph, { root }).ok, true);
    writeFileSync(join(root, "portfolio.md"), "# Portfolio\n");

    const result = checkLineage(graph, { root });
    assert.equal(result.ok, false);
    assert.match(result.issues.map((issue) => issue.code).join(","), /optional-input-created/);
  });

  it("rejects tampered graph and record ids", () => {
    const root = fixture();
    const graph = recordLineage(emptyLineageGraph(), {
      root,
      artifact: "reports/report.md",
      inputs: ["cv.md"],
    });

    assert.equal(verifyLineageGraph({ ...graph, id: "lineage:tampered" }).ok, false);
    assert.equal(verifyLineageGraph({ ...graph, records: [{ ...graph.records[0], id: "record:tampered" }] }).ok, false);
  });
});

function fixture(): string {
  const root = mkdirTemp();
  mkdirSync(join(root, "jobs"), { recursive: true });
  mkdirSync(join(root, "reports"), { recursive: true });
  mkdirSync(join(root, "generated"), { recursive: true });
  writeFileSync(join(root, "cv.md"), "# CV\n\nAgent engineer.\n");
  writeFileSync(join(root, "profile.yml"), "name: Example\n");
  writeFileSync(join(root, "jobs", "job.md"), "# Job\n\nBuild agent workflows.\n");
  writeFileSync(join(root, "reports", "report.md"), "# Report\n\nScore: 4.2\n");
  writeFileSync(join(root, "generated", "report.pdf"), "PDF bytes\n");
  return root;
}

function mkdirTemp(): string {
  const root = join(tmpdir(), `iso-lineage-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

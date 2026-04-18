import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeCost, formatCost } from "../src/cli/cost.js";
import type { DiscoveredFile } from "../src/lint/scanner.js";

function file(rel_path: string, source: string): DiscoveredFile {
  return { abs_path: "/" + rel_path, rel_path, source };
}

describe("cost report", () => {
  it("buckets files into shared-prefix, modes, and agents", () => {
    const report = computeCost([
      file("AGENTS.md", "# Shared\n\n" + "word ".repeat(200)),
      file("CLAUDE.md", "# Shared\n\n" + "word ".repeat(200)),
      file("modes/apply.md", "# Apply\n\n" + "word ".repeat(100)),
      file("modes/scan.md", "# Scan\n\n" + "word ".repeat(80)),
      file("iso/agents/general-free.md", "# Agent\n\n" + "word ".repeat(50)),
      file("README.md", "# Unrelated\n\n" + "word ".repeat(500)),
    ]);

    assert.equal(report.shared_prefix.length, 2);
    assert.ok(report.shared_prefix.some((f) => f.path === "AGENTS.md"));
    assert.ok(report.shared_prefix.some((f) => f.path === "CLAUDE.md"));

    assert.equal(report.modes.length, 2);
    assert.equal(report.agents.length, 1);

    // README.md is not bucketed because it's not a harness path.
    const allPaths = [
      ...report.shared_prefix.map((f) => f.path),
      ...report.modes.map((f) => f.path),
      ...report.agents.map((f) => f.path),
    ];
    assert.ok(!allPaths.includes("README.md"));
  });

  it("sorts each bucket by approx_tokens descending", () => {
    const report = computeCost([
      file("modes/small.md", "# S\n\n" + "word ".repeat(20)),
      file("modes/large.md", "# L\n\n" + "word ".repeat(500)),
      file("modes/medium.md", "# M\n\n" + "word ".repeat(100)),
    ]);
    const paths = report.modes.map((f) => f.path);
    assert.deepEqual(paths, ["modes/large.md", "modes/medium.md", "modes/small.md"]);
    assert.equal(report.heaviest_mode?.path, "modes/large.md");
  });

  it("groups shared-prefix by tool instead of summing across tools", () => {
    // AGENTS.md and CLAUDE.md belong to DIFFERENT tools — summing would
    // lie. This is the bug-fix test for the per-tool refactor.
    const report = computeCost([
      file("AGENTS.md", "x".repeat(4000)),
      file("CLAUDE.md", "x".repeat(4000)),
    ]);

    // Each file is ~1000 tokens. If summed flatly you'd get 2000. With
    // per-tool grouping the Claude Code group is 1000 and the AGENTS.md
    // group is 1000 — worst case is 1000, not 2000.
    assert.equal(report.worst_tool_tokens, 1000);
    assert.ok(report.tools.length >= 2);
    const byId = Object.fromEntries(report.tools.map((t) => [t.id, t.approx_tokens]));
    assert.equal(byId["claude-code"], 1000);
    assert.equal(byId["agents-md"], 1000);
  });

  it("opencode group includes AGENTS.md + modes/_shared.md together", () => {
    const report = computeCost([
      file("AGENTS.md", "x".repeat(4000)),
      file("modes/_shared.md", "x".repeat(2000)),
    ]);
    const oc = report.tools.find((t) => t.id === "agents-md");
    assert.ok(oc);
    assert.equal(oc.files.length, 2);
    assert.equal(oc.approx_tokens, 1000 + 500);
    assert.equal(report.worst_tool_tokens, 1500);
  });

  it("uses iso/instructions.md as a stand-in when tool-specific file is not tracked", () => {
    const report = computeCost([
      file("iso/instructions.md", "x".repeat(4000)),
      file("modes/_shared.md", "x".repeat(2000)),
    ]);
    // iso stands in for CLAUDE.md → Claude Code group
    const claude = report.tools.find((t) => t.id === "claude-code");
    assert.ok(claude);
    assert.equal(claude.files[0].path, "iso/instructions.md");
    assert.ok(claude.note && /stands in/.test(claude.note));

    // iso stands in for AGENTS.md, plus modes/_shared.md → opencode group
    const oc = report.tools.find((t) => t.id === "agents-md");
    assert.ok(oc);
    assert.equal(oc.approx_tokens, 1000 + 500);
    assert.ok(oc.note && /stands in/.test(oc.note));

    // Worst case is opencode at 1500 tokens.
    assert.equal(report.worst_tool_tokens, 1500);
    assert.equal(report.worst_tool?.id, "agents-md");
  });

  it("prefers the tracked tool-specific file over iso/ when both are present", () => {
    // A repo that tracks both iso/ source AND compiled AGENTS.md: opencode
    // at runtime loads AGENTS.md, not iso/. Group should reflect AGENTS.md
    // as the base, with no fallback note.
    const report = computeCost([
      file("iso/instructions.md", "x".repeat(8000)),
      file("AGENTS.md", "x".repeat(4000)),
    ]);
    const oc = report.tools.find((t) => t.id === "agents-md");
    assert.ok(oc);
    assert.equal(oc.files[0].path, "AGENTS.md");
    assert.equal(oc.files[0].approx_tokens, 1000);
    assert.equal(oc.note, undefined);
  });

  it("computes per-section breakdown for shared-prefix files", () => {
    const source = [
      "## Alpha",
      "",
      "word ".repeat(500),
      "",
      "## Beta",
      "",
      "word ".repeat(100),
    ].join("\n");
    const report = computeCost([file("AGENTS.md", source)]);
    const sections = report.shared_prefix[0].sections;
    assert.ok(sections && sections.length === 2);
    assert.equal(sections[0].title, "Alpha");
    assert.ok(sections[0].approx_tokens > sections[1].approx_tokens);
  });

  it("strips frontmatter before counting words", () => {
    const withFrontmatter = [
      "---",
      "description: test",
      "tags: [a, b, c]",
      "---",
      "",
      "body word word word",
    ].join("\n");
    const without = "body word word word";
    const a = computeCost([file("AGENTS.md", withFrontmatter)]);
    const b = computeCost([file("AGENTS.md", without)]);
    assert.equal(a.shared_prefix[0].words, b.shared_prefix[0].words);
  });

  it("formats a readable per-tool text report", () => {
    const report = computeCost([
      file("AGENTS.md", "# S\n\n" + "word ".repeat(500)),
      file("CLAUDE.md", "# S\n\n" + "word ".repeat(500)),
      file("modes/apply.md", "# A\n\n" + "word ".repeat(200)),
    ]);
    const out = formatCost(report);
    assert.ok(out.includes("Per-tool always-loaded cost"));
    assert.ok(out.includes("Claude Code"));
    assert.ok(out.includes("AGENTS.md"));
    assert.ok(out.includes("Per-mode context"));
    assert.ok(out.includes("Worst-case tool"));
  });

  it("does not crash on empty input", () => {
    const report = computeCost([]);
    assert.equal(report.shared_prefix.length, 0);
    assert.equal(report.tools.length, 0);
    assert.equal(report.worst_tool_tokens, 0);
    const out = formatCost(report);
    assert.ok(out.includes("no shared-prefix"));
  });
});

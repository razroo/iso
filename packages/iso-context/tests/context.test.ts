import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  estimateTokens,
  loadContextPolicy,
  planContext,
  renderContextPlan,
  resolveContextBundle,
} from "../src/index.js";

function withFixture(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-context-"));
  try {
    mkdirSync(join(dir, "iso"), { recursive: true });
    mkdirSync(join(dir, "modes"), { recursive: true });
    writeFileSync(join(dir, "iso", "instructions.md"), "base instructions\n", "utf8");
    writeFileSync(join(dir, "modes", "apply.md"), "apply runbook\nwith details\n", "utf8");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const input = {
  defaults: {
    tokenBudget: 20,
    charsPerToken: 4,
  },
  bundles: [
    {
      name: "base",
      files: [
        { path: "iso/instructions.md", maxTokens: 10 },
      ],
      notes: ["base note"],
    },
    {
      name: "apply",
      extends: "base",
      files: [
        "modes/apply.md",
        { path: "modes/reference-geometra.md", required: false },
      ],
      notes: ["child note"],
    },
  ],
} as const;

test("loads, resolves, and plans inherited context bundles", () => {
  withFixture((dir) => {
    const policy = loadContextPolicy(input);
    const bundle = resolveContextBundle(policy, "apply");

    assert.deepEqual(bundle.extends, ["base"]);
    assert.deepEqual(bundle.files.map((file) => file.path), [
      "iso/instructions.md",
      "modes/apply.md",
      "modes/reference-geometra.md",
    ]);
    assert.deepEqual(bundle.notes, ["base note", "child note"]);

    const plan = planContext(policy, "apply", { root: dir, includeContent: true });
    assert.equal(plan.ok, true);
    assert.equal(plan.totals.files, 3);
    assert.equal(plan.totals.existing, 2);
    assert.equal(plan.files[0]?.content, "base instructions\n");
  });
});

test("fails checks for missing required files and budget overruns", () => {
  withFixture((dir) => {
    const policy = loadContextPolicy({
      bundles: [
        {
          name: "strict",
          tokenBudget: 1,
          files: [
            { path: "missing.md" },
            { path: "modes/apply.md", maxTokens: 1 },
          ],
        },
      ],
    });

    const plan = planContext(policy, "strict", { root: dir });
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.issues.map((issue) => issue.kind), [
      "missing-required-file",
      "file-over-budget",
      "bundle-over-budget",
    ]);
  });
});

test("detects duplicate bundles, unknown parents, and inheritance cycles", () => {
  assert.throws(
    () => loadContextPolicy([{ name: "a" }, { name: "a" }]),
    /duplicate context bundle "a"/,
  );
  assert.throws(
    () => loadContextPolicy([{ name: "a", extends: "missing" }]),
    /extends unknown bundle "missing"/,
  );
  assert.throws(
    () => loadContextPolicy([{ name: "a", extends: "b" }, { name: "b", extends: "a" }]),
    /context bundle cycle: a -> b -> a/,
  );
});

test("estimates and renders context deterministically", () => {
  withFixture((dir) => {
    assert.equal(estimateTokens("12345", 4), 2);

    const policy = loadContextPolicy(input);
    const plan = planContext(policy, "apply", { root: dir, includeContent: true });
    const rendered = renderContextPlan(plan);

    assert.match(rendered, /# iso-context bundle: apply/);
    assert.match(rendered, /### iso\/instructions\.md/);
    assert.match(rendered, /base instructions/);
  });
});

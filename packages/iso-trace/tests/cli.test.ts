import { test } from "node:test";
import assert from "node:assert/strict";
import { modelScoreFailureReasons, parseModelScoreArgs } from "../src/cli.js";
import type { ModelScore } from "../src/scorecard.js";

test("parseModelScoreArgs supports since-hours and repeated fail-on-model flags", () => {
  const before = Date.now();
  const parsed = parseModelScoreArgs([
    "--since-hours",
    "0.5",
    "--tool",
    "read",
    "--fail-on-schema",
    "--fail-on-model",
    "openrouter/minimax/minimax-m2.5:free",
    "--fail-on-model",
    "openrouter/z-ai/glm-4.5-air:free",
    "--json",
  ]);
  const after = Date.now();

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.tool, "read");
  assert.equal(parsed.failOnSchema, true);
  assert.deepEqual(parsed.failOnModels, [
    "openrouter/minimax/minimax-m2.5:free",
    "openrouter/z-ai/glm-4.5-air:free",
  ]);
  assert.equal(parsed.json, true);
  assert.ok(parsed.sinceMs !== undefined);
  assert.ok(parsed.since !== undefined);
  assert.ok(parsed.sinceMs >= before - 1_800_000 - 100);
  assert.ok(parsed.sinceMs <= after - 1_800_000 + 100);
});

test("parseModelScoreArgs rejects conflicting since flags", () => {
  const parsed = parseModelScoreArgs(["--since", "6h", "--since-hours", "1"]);
  assert.equal(parsed.error, "iso-trace model-score: pass either --since or --since-hours, not both");
});

test("modelScoreFailureReasons reports schema and blocked-model regressions", () => {
  const scores: ModelScore[] = [
    {
      model: "openrouter/minimax/minimax-m2.5:free",
      sessions: 1,
      calls: 2,
      completed: 0,
      errors: 2,
      schemaErrors: 2,
      successRate: 0,
      latestAt: "2026-04-21T00:00:00.000Z",
      readInputShapes: { filePath: 0, path: 2, file_path: 0, other: 0 },
    },
    {
      model: "opencode/big-pickle",
      sessions: 1,
      calls: 3,
      completed: 3,
      errors: 0,
      schemaErrors: 0,
      successRate: 1,
      latestAt: "2026-04-21T00:10:00.000Z",
      readInputShapes: { filePath: 3, path: 0, file_path: 0, other: 0 },
    },
  ];

  const reasons = modelScoreFailureReasons(scores, {
    failOnSchema: true,
    failOnModels: ["openrouter/minimax/minimax-m2.5:free"],
  });

  assert.deepEqual(reasons, [
    "schema errors observed: openrouter/minimax/minimax-m2.5:free (2)",
    "blocked models observed: openrouter/minimax/minimax-m2.5:free (2)",
  ]);
});

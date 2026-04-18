import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { formatVerifyReport, verify } from "../src/cli/verify.js";
import { MockProvider } from "../src/providers/mock.js";

describe("verify", () => {
  it("reports harness performance deltas when a performance fix applies", async () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "isolint-verify-"));
    try {
      mkdirSync(resolve(cwd, "modes"), { recursive: true });
      writeFileSync(
        resolve(cwd, ".isolint.json"),
        JSON.stringify({ extends: ["recommended", "performance"] }) + "\n",
        "utf8",
      );
      writeFileSync(
        resolve(cwd, "modes/test.md"),
        "Return JSON in a friendly, conversational tone.\n",
        "utf8",
      );
      writeFileSync(resolve(cwd, "input.json"), "{}\n", "utf8");

      const report = await verify({
        harness_path: "modes/test.md",
        input_path: "input.json",
        model: new MockProvider("small", () => '{"ok":true}'),
        fixModel: new MockProvider("large", () => "ignored"),
        cwd,
      });

      assert.equal(report.after.applied_fixes, 1);
      assert.equal(report.performance.before.findings, 1);
      assert.equal(report.performance.after.findings, 0);
      assert.ok(report.performance.diff.char_delta < 0);
      assert.ok(report.performance.diff.word_delta < 0);
      assert.equal(report.performance.diff.by_rule["perf-style-tone-overhead"], -1);

      const formatted = formatVerifyReport(report);
      assert.match(formatted, /HARNESS PERFORMANCE/);
      assert.match(formatted, /chars:\s+\d+ -> \d+ \(-\d+\)/);
      assert.match(formatted, /perf-style-tone-overhead: 1 -> 0 \(-1\)/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

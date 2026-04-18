import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../src/cli/args.js";

function flagArrayHelper(
  flags: Record<string, string | boolean>,
  key: string,
): string[] {
  const v = flags[key];
  if (typeof v !== "string") return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

describe("parseArgs", () => {
  it("parses command and positional args", () => {
    const r = parseArgs(["lint", "src/"]);
    assert.equal(r.command, "lint");
    assert.deepEqual(r.positional, ["src/"]);
  });

  it("parses --key value and --key=value forms", () => {
    const r = parseArgs(["lint", "--format", "json", "--fail-on=warn"]);
    assert.equal(r.flags.format, "json");
    assert.equal(r.flags["fail-on"], "warn");
  });

  it("parses standalone boolean flags", () => {
    const r = parseArgs(["lint", "--fix", "--llm"]);
    assert.equal(r.flags.fix, true);
    assert.equal(r.flags.llm, true);
  });

  it("accumulates repeated string flags as comma-joined values", () => {
    const r = parseArgs([
      "lint",
      "--preset",
      "recommended",
      "--preset",
      "performance",
    ]);
    assert.equal(r.flags.preset, "recommended,performance");
    assert.deepEqual(flagArrayHelper(r.flags, "preset"), [
      "recommended",
      "performance",
    ]);
  });

  it("accepts comma-separated values equivalently to repeated flags", () => {
    const a = parseArgs(["lint", "--preset", "recommended,performance"]);
    const b = parseArgs([
      "lint",
      "--preset",
      "recommended",
      "--preset=performance",
    ]);
    assert.deepEqual(
      flagArrayHelper(a.flags, "preset"),
      flagArrayHelper(b.flags, "preset"),
    );
  });

  it("repeated --ignore globs accumulate", () => {
    const r = parseArgs([
      "lint",
      "--ignore",
      "docs/**",
      "--ignore",
      "examples/**",
    ]);
    assert.deepEqual(flagArrayHelper(r.flags, "ignore"), [
      "docs/**",
      "examples/**",
    ]);
  });
});

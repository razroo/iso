import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { CheckType, Expectation } from "./checks.js";

export interface FixtureCase {
  name: string;
  input: unknown;
  expectations: Expectation[];
}

export interface Fixtures {
  agent?: string;
  cases: FixtureCase[];
}

const VALID_CHECKS: ReadonlySet<CheckType> = new Set<CheckType>([
  "word_count_le",
  "word_count_ge",
  "char_count_le",
  "does_not_contain",
  "contains_all",
  "regex",
  "llm_judge",
]);

export function loadFixtures(path: string): Fixtures {
  const raw = readFileSync(path, "utf8");
  const parsed = YAML.parse(raw);
  if (!parsed || !Array.isArray(parsed.cases)) {
    throw new Error(`Fixture file ${path} must have a top-level "cases:" array`);
  }
  for (const c of parsed.cases) {
    if (!c.name) throw new Error(`A case in ${path} is missing a "name:" field`);
    if (!Array.isArray(c.expectations)) {
      throw new Error(`Case "${c.name}" in ${path} is missing an "expectations:" array`);
    }
    for (const e of c.expectations) {
      if (!e.rule) throw new Error(`Expectation in case "${c.name}" is missing "rule:"`);
      if (!e.check) throw new Error(`Expectation for rule [${e.rule}] in case "${c.name}" is missing "check:"`);
      if (!VALID_CHECKS.has(e.check)) {
        const valid = [...VALID_CHECKS].join(", ");
        throw new Error(
          `Expectation for rule [${e.rule}] in case "${c.name}" has unknown check "${e.check}" — valid checks: ${valid}`,
        );
      }
      if (e.check === "llm_judge") {
        if (typeof e.prompt !== "string" || !e.prompt.trim()) {
          throw new Error(
            `Expectation for rule [${e.rule}] in case "${c.name}" uses check "llm_judge" but is missing a "prompt:" field`,
          );
        }
      } else if (e.value === undefined || e.value === null) {
        throw new Error(
          `Expectation for rule [${e.rule}] in case "${c.name}" uses check "${e.check}" but is missing a "value:" field`,
        );
      }
      if (e.mode !== undefined) {
        if (e.mode !== "substring" && e.mode !== "regex") {
          throw new Error(
            `Expectation for rule [${e.rule}] in case "${c.name}" has unknown mode "${e.mode}" — valid modes: substring, regex`,
          );
        }
        if (e.check !== "does_not_contain" && e.check !== "contains_all") {
          throw new Error(
            `Expectation for rule [${e.rule}] in case "${c.name}" sets mode on check "${e.check}" — mode is only valid on does_not_contain and contains_all`,
          );
        }
      }
    }
  }
  return parsed as Fixtures;
}

export function formatInput(input: unknown): string {
  if (typeof input === "string") return input;
  return YAML.stringify(input).trimEnd();
}

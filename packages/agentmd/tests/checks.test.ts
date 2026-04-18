import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheck } from "../src/checks.js";

test("word_count_le pass and fail", async () => {
  const pass = await runCheck({ rule: "H1", check: "word_count_le", value: 5 }, "one two three");
  assert.equal(pass.passed, true);
  const fail = await runCheck({ rule: "H1", check: "word_count_le", value: 2 }, "one two three");
  assert.equal(fail.passed, false);
});

test("does_not_contain case-insensitive", async () => {
  const fail = await runCheck(
    { rule: "H1", check: "does_not_contain", value: ["foo", "bar"] },
    "The FOO is here",
  );
  assert.equal(fail.passed, false);
  assert.match(fail.detail, /foo/i);

  const pass = await runCheck(
    { rule: "H1", check: "does_not_contain", value: ["quux"] },
    "foo bar baz",
  );
  assert.equal(pass.passed, true);
});

test("contains_all missing values", async () => {
  const result = await runCheck(
    { rule: "D1", check: "contains_all", value: ["alpha", "beta"] },
    "alpha only",
  );
  assert.equal(result.passed, false);
  assert.match(result.detail, /beta/);
});

test("regex check", async () => {
  const ok = await runCheck({ rule: "D1", check: "regex", value: "^hello" }, "hello world");
  assert.equal(ok.passed, true);
  const no = await runCheck({ rule: "D1", check: "regex", value: "^hello" }, "world hello");
  assert.equal(no.passed, false);
});

test("llm_judge with injected judge", async () => {
  const judge = async (prompt: string, output: string) =>
    prompt.includes("specific") && output.includes("Acme");
  const yes = await runCheck(
    { rule: "D1", check: "llm_judge", prompt: "Is the opener specific to Acme?" },
    "Noticed Acme's push into…",
    judge,
  );
  assert.equal(yes.passed, true);
  const no = await runCheck(
    { rule: "D1", check: "llm_judge", prompt: "Is the opener specific to Acme?" },
    "Hope you're well.",
    judge,
  );
  assert.equal(no.passed, false);
});

test("llm_judge without judge fails informatively", async () => {
  const r = await runCheck(
    { rule: "D1", check: "llm_judge", prompt: "Anything?" },
    "output",
  );
  assert.equal(r.passed, false);
  assert.match(r.detail, /judge/);
});

test("regex check with invalid pattern fails gracefully", async () => {
  const r = await runCheck(
    { rule: "D1", check: "regex", value: "[" },
    "anything",
  );
  assert.equal(r.passed, false);
  assert.match(r.detail, /invalid regex/);
});

test("does_not_contain regex mode matches patterns", async () => {
  const fail = await runCheck(
    {
      rule: "D2",
      check: "does_not_contain",
      mode: "regex",
      value: ["Worth grabbing.*\\?", "Would you be open.*\\?"],
    },
    "Worth grabbing 15 minutes next week?",
  );
  assert.equal(fail.passed, false);
  assert.match(fail.detail, /forbidden pattern/);

  const pass = await runCheck(
    {
      rule: "D2",
      check: "does_not_contain",
      mode: "regex",
      value: ["Worth grabbing.*\\?"],
    },
    "Can we meet Tuesday at 2pm ET?",
  );
  assert.equal(pass.passed, true);
});

test("contains_all regex mode requires every pattern to match", async () => {
  const pass = await runCheck(
    {
      rule: "D1",
      check: "contains_all",
      mode: "regex",
      value: ["\\bAcme\\b", "\\d+ microservices"],
    },
    "Acme runs 200 microservices on GKE.",
  );
  assert.equal(pass.passed, true);

  const fail = await runCheck(
    {
      rule: "D1",
      check: "contains_all",
      mode: "regex",
      value: ["\\bAcme\\b", "\\d+ microservices"],
    },
    "Acme is a company.",
  );
  assert.equal(fail.passed, false);
  assert.match(fail.detail, /microservices/);
});

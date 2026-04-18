import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, extractIdReferences } from "../src/parser.js";

const SAMPLE = `# Agent: test-agent

A short description.

## Hard limits

- [H1] Max 100 words.
  why: long replies get ignored
- [H2] No placeholders.
  why: placeholders leak to customers

## Defaults

- [D1] Open with specificity.
  why: generic openers look like spam

## Procedure

1. Read input
2. Draft reply
3. Self-check against [H1] and [H2]

## Routing

| When | Do |
|------|-----|
| IC | Technical framing |
| otherwise | Default framing |

## Output format

Plain text only.
`;

test("parse: agent name and description", () => {
  const doc = parse(SAMPLE);
  assert.equal(doc.agent, "test-agent");
  assert.equal(doc.description, "A short description.");
});

test("parse: hard limits with why", () => {
  const doc = parse(SAMPLE);
  assert.equal(doc.hardLimits.length, 2);
  assert.equal(doc.hardLimits[0].id, "H1");
  assert.equal(doc.hardLimits[0].claim, "Max 100 words.");
  assert.equal(doc.hardLimits[0].why, "long replies get ignored");
  assert.equal(doc.hardLimits[0].scope, "hard");
});

test("parse: defaults separate from hard limits", () => {
  const doc = parse(SAMPLE);
  assert.equal(doc.defaults.length, 1);
  assert.equal(doc.defaults[0].id, "D1");
  assert.equal(doc.defaults[0].scope, "default");
});

test("parse: numbered procedure steps", () => {
  const doc = parse(SAMPLE);
  assert.equal(doc.procedure.length, 3);
  assert.deepEqual(
    doc.procedure.map((s) => [s.index, s.text]),
    [
      [1, "Read input"],
      [2, "Draft reply"],
      [3, "Self-check against [H1] and [H2]"],
    ],
  );
});

test("parse: routing table without treating header as a row", () => {
  const doc = parse(SAMPLE);
  assert.equal(doc.routing.length, 2);
  assert.equal(doc.routing[0].when, "IC");
  assert.equal(doc.routing[0].then, "Technical framing");
  assert.equal(doc.routing[1].when, "otherwise");
});

test("parse: unknown H2 becomes context bucket", () => {
  const doc = parse(SAMPLE);
  assert.equal(doc.context.length, 1);
  assert.equal(doc.context[0].heading, "Output format");
  assert.equal(doc.context[0].body, "Plain text only.");
});

test("parse: rule without why keeps null", () => {
  const doc = parse(`# Agent: x\n\n## Hard limits\n\n- [H1] do a thing\n`);
  assert.equal(doc.hardLimits[0].why, null);
});

test("extractIdReferences finds bracketed ids", () => {
  assert.deepEqual(
    extractIdReferences("see [H1] and [D2] but not [foo] alone"),
    ["H1", "D2"],
  );
});

test("parse: multiline rule claim before why:", () => {
  const src = `# Agent: a

## Hard limits

- [H1] first line of the claim
  second line that wraps
  third line still in the claim
  why: the reason

## Procedure

1. step
`;
  const doc = parse(src);
  assert.equal(doc.hardLimits.length, 1);
  assert.equal(
    doc.hardLimits[0].claim,
    "first line of the claim second line that wraps third line still in the claim",
  );
  assert.equal(doc.hardLimits[0].why, "the reason");
});

test("parse: routing table with non-canonical header", () => {
  const src = `# Agent: a

## Hard limits

- [H1] thing
  why: reason

## Procedure

1. step

## Routing

| Scenario | Behavior |
|----------|----------|
| IC engineer | technical framing |
| otherwise | business framing |
`;
  const doc = parse(src);
  assert.equal(doc.routing.length, 2);
  assert.equal(doc.routing[0].when, "IC engineer");
  assert.equal(doc.routing[0].then, "technical framing");
  assert.equal(doc.routing[1].when, "otherwise");
});

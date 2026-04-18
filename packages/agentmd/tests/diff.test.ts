import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { diffPrompts, formatDiff } from "../src/diff.js";

const OLD = `# Agent: a

## Hard limits

- [H1] Produce at most 140 words.
  why: emails over 140 have under 2% reply rate
- [H2] Never fabricate metrics.
  why: fabricated ARR figures lose deals

## Defaults

- [D1] Open with a specific observation.
  why: generic openers get filtered as spam

## Procedure

1. step
`;

const NEW = `# Agent: a

## Hard limits

- [H1] Produce at most 120 words.
  why: emails over 140 have under 2% reply rate
- [H3] Do not use placeholder tokens.
  why: placeholders leak when copy is pasted into a send tool

## Defaults

- [D1] Open with a specific observation.
  why: generic openers get filtered as spam
- [D2] Close with a direct ask.
  why: hedged phrasing drops reply rate measurably

## Procedure

1. step
2. step two
`;

test("diffPrompts: captures added, removed, claim-changed", () => {
  const d = diffPrompts(parse(OLD), parse(NEW));
  assert.deepEqual(d.added.map((r) => r.id).sort(), ["D2", "H3"]);
  assert.deepEqual(d.removed.map((r) => r.id), ["H2"]);
  assert.deepEqual(d.claimChanged.map((c) => c.id), ["H1"]);
  assert.deepEqual(d.scopeChanged, []);
  assert.deepEqual(d.whyChanged, []);
  assert.equal(d.procedureDelta, 1);
  assert.equal(d.routingDelta, 0);
});

test("diffPrompts: no changes returns empty diff", () => {
  const d = diffPrompts(parse(OLD), parse(OLD));
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
  assert.equal(d.claimChanged.length, 0);
  assert.equal(d.procedureDelta, 0);
});

test("formatDiff: renders the delta in a reviewable shape", () => {
  const d = diffPrompts(parse(OLD), parse(NEW));
  const rendered = formatDiff("a", "a", d);
  assert.match(rendered, /\+ \[H3\]/);
  assert.match(rendered, /- \[H2\]/);
  assert.match(rendered, /claim changed/);
  assert.match(rendered, /procedure steps: \+1/);
});

test("formatDiff: says 'no structural changes' when nothing differs", () => {
  const d = diffPrompts(parse(OLD), parse(OLD));
  const rendered = formatDiff("a", "a", d);
  assert.match(rendered, /no structural changes/);
});

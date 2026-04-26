import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendEvent,
  hasEvent,
  materializeLedger,
  queryEvents,
  readLedger,
  verifyLedgerText,
} from "../src/index.js";

function withTempLedger(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-ledger-"));
  try {
    run(join(dir, "events.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("appendEvent writes JSONL and dedupes by idempotency key", () => {
  withTempLedger((path) => {
    const first = appendEvent({ path }, {
      type: "application.submitted",
      at: "2026-04-26T00:00:00.000Z",
      key: "url:https://example.test/job/1",
      subject: "job:example:engineer",
      idempotencyKey: "apply:https://example.test/job/1",
      data: { company: "Example", status: "applied" },
    });
    const second = appendEvent({ path }, {
      type: "application.submitted",
      at: "2026-04-26T00:01:00.000Z",
      key: "url:https://example.test/job/1",
      subject: "job:example:engineer",
      idempotencyKey: "apply:https://example.test/job/1",
      data: { company: "Example", status: "duplicate" },
    });

    assert.equal(first.appended, true);
    assert.equal(second.appended, false);
    assert.equal(second.event.id, first.event.id);
    const events = readLedger({ path });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.data.status, "applied");
  });
});

test("queryEvents filters by type, key, subject, and data path", () => {
  const events = [
    {
      id: "evt_1",
      type: "scan.found",
      at: "2026-04-26T00:00:00.000Z",
      key: "url:a",
      subject: "job:a",
      data: { status: "new", score: 4 },
      meta: {},
    },
    {
      id: "evt_2",
      type: "application.submitted",
      at: "2026-04-26T00:01:00.000Z",
      key: "url:b",
      subject: "job:b",
      data: { status: "applied", score: 5 },
      meta: {},
    },
  ];

  const matches = queryEvents(events, {
    type: "application.submitted",
    where: { status: "applied", score: 5 },
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "evt_2");
  assert.equal(hasEvent(events, { key: "url:a" }), true);
  assert.equal(hasEvent(events, { key: "url:missing" }), false);
});

test("verifyLedgerText catches invalid lines and duplicate ids", () => {
  const result = verifyLedgerText([
    JSON.stringify({ id: "evt_1", type: "scan.found", at: "2026-04-26T00:00:00.000Z", data: {}, meta: {} }),
    "{not json}",
    JSON.stringify({ id: "evt_1", type: "scan.found", at: "2026-04-26T00:00:01.000Z", data: {}, meta: {} }),
  ].join("\n"));

  assert.equal(result.ok, false);
  assert.equal(result.eventCount, 2);
  assert.equal(result.errors, 2);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["invalid-json", "duplicate-id"]);
});

test("materializeLedger builds subject state from events", () => {
  const view = materializeLedger([
    {
      id: "evt_1",
      type: "job.created",
      at: "2026-04-26T00:00:00.000Z",
      subject: "job:1",
      data: { company: "Example", status: "new" },
      meta: {},
    },
    {
      id: "evt_2",
      type: "job.updated",
      at: "2026-04-26T00:01:00.000Z",
      subject: "job:1",
      data: { status: "applied" },
      meta: {},
    },
  ], "2026-04-26T00:02:00.000Z");

  assert.equal(view.eventCount, 2);
  assert.equal(view.entityCount, 1);
  assert.equal(view.entities["job:1"]?.data.company, "Example");
  assert.equal(view.entities["job:1"]?.data.status, "applied");
  assert.equal(view.entities["job:1"]?.lastEventType, "job.updated");
});

test("readLedger rejects non-object data", () => {
  withTempLedger((path) => {
    writeFileSync(path, JSON.stringify({
      id: "evt_bad",
      type: "bad",
      at: "2026-04-26T00:00:00.000Z",
      data: [],
      meta: {},
    }));

    assert.throws(() => readLedger({ path }), /expected a ledger event object/);
  });
});

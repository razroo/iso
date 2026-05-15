import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WorkflowLeaseConflictError,
  openWorkflow,
  readWorkflowRecord,
  workflowLeaseStatus,
} from '../src/index.js';

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iso-orchestrator-lease-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('heartbeat() persists the latest heartbeat for a key', async () => {
  await withTempDir(async (dir) => {
    const workflow = await openWorkflow({
      workflowId: 'heartbeats',
      dir,
      initialState: { ok: true },
      now: () => new Date('2026-05-14T12:00:00.000Z'),
    });

    const heartbeat = await workflow.heartbeat('worker:alpha', { phase: 'dispatch' });
    assert.equal(heartbeat.key, 'worker:alpha');
    assert.equal(heartbeat.at, '2026-05-14T12:00:00.000Z');
    assert.deepEqual(heartbeat.detail, { phase: 'dispatch' });

    const record = await readWorkflowRecord({
      workflowId: 'heartbeats',
      dir,
      initialState: { ok: true },
      now: () => new Date('2026-05-14T12:00:00.000Z'),
    });
    assert.deepEqual(record.heartbeats?.['worker:alpha'], heartbeat);
  });
});

test('touchLease() acquires, renews, conflicts, expires, and releases', async () => {
  await withTempDir(async (dir) => {
    let now = new Date('2026-05-14T12:00:00.000Z');
    const workflow = await openWorkflow({
      workflowId: 'leases',
      dir,
      initialState: { ok: true },
      now: () => now,
    });

    const acquired = await workflow.touchLease('worker:apply-1', {
      holder: 'codex:alpha',
      ttlMs: 30_000,
      detail: { stage: 'browser-open' },
    });
    assert.equal(acquired.acquiredAt, '2026-05-14T12:00:00.000Z');
    assert.equal(acquired.heartbeatAt, '2026-05-14T12:00:00.000Z');
    assert.equal(acquired.expiresAt, '2026-05-14T12:00:30.000Z');
    assert.equal(workflowLeaseStatus(acquired, now), 'active');

    now = new Date('2026-05-14T12:00:10.000Z');
    const renewed = await workflow.touchLease('worker:apply-1', {
      holder: 'codex:alpha',
      ttlMs: 30_000,
      detail: { stage: 'filling-form' },
    });
    assert.equal(renewed.acquiredAt, '2026-05-14T12:00:00.000Z');
    assert.equal(renewed.heartbeatAt, '2026-05-14T12:00:10.000Z');
    assert.equal(renewed.expiresAt, '2026-05-14T12:00:40.000Z');
    assert.deepEqual(renewed.detail, { stage: 'filling-form' });

    await assert.rejects(
      workflow.touchLease('worker:apply-1', {
        holder: 'codex:beta',
        ttlMs: 30_000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowLeaseConflictError);
        assert.equal(error.leaseKey, 'worker:apply-1');
        assert.equal(error.currentHolder, 'codex:alpha');
        return true;
      },
    );

    now = new Date('2026-05-14T12:00:41.000Z');
    const takenOver = await workflow.touchLease('worker:apply-1', {
      holder: 'codex:beta',
      ttlMs: 15_000,
    });
    assert.equal(takenOver.holder, 'codex:beta');
    assert.equal(takenOver.acquiredAt, '2026-05-14T12:00:41.000Z');
    assert.equal(workflowLeaseStatus(takenOver, now), 'active');

    now = new Date('2026-05-14T12:00:42.000Z');
    const released = await workflow.releaseLease('worker:apply-1', 'codex:beta');
    assert.equal(released?.releasedAt, '2026-05-14T12:00:42.000Z');
    assert.equal(released ? workflowLeaseStatus(released, now) : undefined, 'released');

    const record = await readWorkflowRecord({
      workflowId: 'leases',
      dir,
      initialState: { ok: true },
      now: () => now,
    });
    assert.equal(record.leases?.['worker:apply-1']?.holder, 'codex:beta');
    assert.equal(record.leases?.['worker:apply-1']?.releasedAt, '2026-05-14T12:00:42.000Z');
  });
});

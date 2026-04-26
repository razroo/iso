import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openWorkflow, readWorkflowRecord, runWorkflow } from '../src/index.js';

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iso-orchestrator-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('step() is idempotent across repeated calls and repeated runs', async () => {
  await withTempDir(async (dir) => {
    let calls = 0;

    const first = await runWorkflow(
      {
        workflowId: 'job-apply',
        dir,
        initialState: { applied: 0 },
      },
      async (workflow) => {
        const firstResult = await workflow.step('cleanup', async () => {
          calls += 1;
          return { cleaned: true };
        });
        const secondResult = await workflow.step('cleanup', async () => {
          calls += 1;
          return { cleaned: false };
        });

        assert.deepEqual(firstResult, { cleaned: true });
        assert.deepEqual(secondResult, { cleaned: true });

        await workflow.updateState((state) => ({ applied: state.applied + 1 }));
        return firstResult;
      },
    );

    assert.equal(calls, 1);
    assert.equal(first.record.state.applied, 1);
    assert.equal(first.record.steps.cleanup.status, 'completed');

    await runWorkflow(
      {
        workflowId: 'job-apply',
        dir,
        initialState: { applied: 999 },
      },
      async (workflow) => {
        const cached = await workflow.step('cleanup', async () => {
          calls += 1;
          return { cleaned: false };
        });
        assert.deepEqual(cached, { cleaned: true });
      },
    );

    assert.equal(calls, 1);

    const record = await readWorkflowRecord({
      workflowId: 'job-apply',
      dir,
      initialState: { applied: 0 },
    });

    assert.equal(record.state.applied, 1);
    assert.equal(record.status, 'completed');
    assert.equal(record.steps.cleanup.attempts, 1);
  });
});

test('step() retries and persists the final successful result', async () => {
  await withTempDir(async (dir) => {
    let attempts = 0;

    const { record } = await runWorkflow(
      {
        workflowId: 'retry-me',
        dir,
        initialState: { ok: false },
      },
      async (workflow) => {
        const result = await workflow.step(
          'submit',
          async ({ attempt }) => {
            attempts += 1;
            if (attempt < 3) throw new Error(`attempt ${attempt} failed`);
            return { attempt, status: 'ok' };
          },
          { retry: 3 },
        );

        await workflow.updateState(() => ({ ok: true }));
        return result;
      },
    );

    assert.equal(attempts, 3);
    assert.equal(record.steps.submit.status, 'completed');
    assert.equal(record.steps.submit.attempts, 3);
    assert.deepEqual(record.steps.submit.result, { attempt: 3, status: 'ok' });
    assert.equal(record.state.ok, true);
  });
});

test('withMutex() serializes same-key work while forEach() still fans out across different keys', async () => {
  await withTempDir(async (dir) => {
    const workflow = await openWorkflow({
      workflowId: 'mutex-batch',
      dir,
      initialState: { seen: 0 },
    });

    const items = [
      { id: 'a1', key: 'alpha' },
      { id: 'a2', key: 'alpha' },
      { id: 'b1', key: 'beta' },
      { id: 'b2', key: 'beta' },
      { id: 'c1', key: 'gamma' },
    ];

    let active = 0;
    let maxActive = 0;
    const activePerKey = new Map<string, number>();
    let overlappedSameKey = false;

    const summary = await workflow.forEach(
      items,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);

        const perKey = (activePerKey.get(item.key) ?? 0) + 1;
        activePerKey.set(item.key, perKey);
        if (perKey > 1) overlappedSameKey = true;

        await sleep(20);

        active -= 1;
        activePerKey.set(item.key, (activePerKey.get(item.key) ?? 1) - 1);
        return item.id;
      },
      {
        maxParallel: 3,
        mutexKey: (item) => item.key,
      },
    );

    assert.equal(overlappedSameKey, false);
    assert.ok(maxActive <= 3);
    assert.equal(summary.fulfilled, items.length);
    assert.equal(summary.rejected, 0);
    assert.deepEqual(
      summary.results.map((entry) => entry.status === 'fulfilled' ? entry.value : 'rejected'),
      items.map((item) => item.id),
    );
  });
});

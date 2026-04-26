# @razroo/iso-orchestrator

Durable workflow primitives for AI-agent harnesses.

This package is for the layer above a single agent session. An agent runtime
already knows how to think, call tools, and emit text. `@razroo/iso-orchestrator`
adds the deterministic parts that should not live only in prompt prose:

- resumable, idempotent `step()` execution with file-backed records
- bounded parallel fan-out with `forEach(..., { maxParallel })`
- keyed mutexes so "same entity" work never runs concurrently
- append-only-ish workflow events and durable state snapshots on local disk

It is intentionally generic. There is no built-in "dispatch a Codex worker"
or "spawn an OpenCode task" primitive yet. Domain packages bring their own
adapter for that part and use this package to enforce invariants around it.

## Install

```bash
npm install @razroo/iso-orchestrator
```

## What it stores

By default the package writes under `.iso-orchestrator/` in the current
working directory:

```text
.iso-orchestrator/
  workflows/
    my-flow-<hash>.json
  locks/
    my-flow-<hash>/
      record.lock/
      mutex/
        company-role-<hash>.lock/
```

The workflow record contains:

- current workflow status (`idle`, `running`, `completed`, `failed`)
- durable JSON state
- step attempt counts and cached step results
- event history (`workflow.running`, `step.started`, `step.completed`, ...)

## Quick example

```ts
import { runWorkflow } from '@razroo/iso-orchestrator';

const { value, record } = await runWorkflow(
  {
    workflowId: 'apply-batch-2026-04-25',
    dir: '.jobforge-runtime',
    initialState: { applied: 0, skipped: 0 },
  },
  async (workflow) => {
    await workflow.step('cleanup-geometra', async () => ({ ok: true }));

    const jobs = [
      { company: 'Anthropic', role: 'Staff Engineer' },
      { company: 'OpenAI', role: 'Member of Technical Staff' },
      { company: 'Anthropic', role: 'Staff Engineer' },
    ];

    const summary = await workflow.forEach(
      jobs,
      async (job) => {
        return workflow.step(
          `apply:${job.company}:${job.role}`,
          async () => {
            // Your own task-dispatch adapter goes here.
            return { outcome: 'APPLIED', company: job.company, role: job.role };
          },
          { idempotencyKey: `${job.company}:${job.role}` },
        );
      },
      {
        maxParallel: 2,
        mutexKey: (job) => `${job.company}:${job.role}`,
      },
    );

    await workflow.updateState((state) => ({
      ...state,
      applied: summary.fulfilled,
      skipped: summary.rejected,
    }));

    return summary;
  },
);

console.log(value.fulfilled, record.status);
```

## API

### `runWorkflow(options, fn)`

Creates or re-opens a workflow record, marks it `running`, executes `fn`, and
marks the workflow `completed` or `failed`.

Options:

- `workflowId`: durable identifier for the logical workflow
- `initialState`: JSON value written only when the workflow record does not exist yet
- `dir`: optional storage root (defaults to `.iso-orchestrator`)
- `now`: optional clock injection for tests

### `openWorkflow(options)`

Opens the workflow context without automatically running a top-level callback.
Useful when you want finer control over lifecycle or only need inspection.

### `workflow.step(name, fn, options?)`

Runs one load-bearing step and persists its result.

- If the same step already completed, the cached JSON result is returned.
- `idempotencyKey` lets one logical step name be reused safely across runs.
- `retry` can be a number (`3`) or `{ attempts, shouldRetry }`.

Results must be JSON-serializable because they are persisted in the record.

### `workflow.withMutex(key, fn, options?)`

Runs `fn` while holding a process-safe filesystem lock for `key`. Useful when
two parallel tasks must never touch the same entity at once.

Options:

- `timeoutMs`: how long to wait for the lock
- `pollMs`: wait interval while the lock is held elsewhere
- `staleAfterMs`: optional stale-lock eviction threshold

### `workflow.forEach(items, fn, options?)`

Bounded fan-out over a list.

- `maxParallel` controls concurrency
- `mutexKey(item)` optionally serializes related items
- `stopOnError` defaults to `true`

Returns a summary with `results`, `fulfilled`, and `rejected`.

### `workflow.updateState(updater)`

Replaces the durable JSON state. Accepts either a full state object or a
functional updater.

### `workflow.appendEvent(input)` / `workflow.getRecord()`

Low-level helpers for custom lifecycle tracking and inspection.

## Scope boundary

This package does not try to be Temporal.

What it does:

- local durable records
- load-bearing step caching
- process-safe local mutexes
- simple bounded concurrency

What it does not do yet:

- distributed queues
- remote workers
- harness-specific task dispatch APIs
- cron / scheduling
- heartbeats and leases

That narrower scope is deliberate. The goal is to let packages like JobForge
stop expressing orchestration invariants only in prompt prose or Bash without
forcing a heavyweight control plane.

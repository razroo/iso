import type {
  AppendEventInput,
  ForEachOptions,
  ForEachSummary,
  JsonValue,
  MutexOptions,
  RetryPolicy,
  RunWorkflowResult,
  StateUpdater,
  StepOptions,
  StepRunContext,
  TouchLeaseInput,
  WorkflowHeartbeatRecord,
  WorkflowContext,
  WorkflowLeaseRecord,
  WorkflowOptions,
  WorkflowRecord,
  WorkflowStatus,
} from './types.js';
import { WorkflowLeaseConflictError, workflowLeaseStatus } from './lease.js';
import {
  WorkflowStore,
  acquireLock,
  clone,
  cloneJson,
  releaseLock,
  serializeError,
  serializedErrorToJson,
} from './storage.js';

function normalizeRetry(retry?: number | RetryPolicy): Required<RetryPolicy> {
  if (typeof retry === 'number') {
    return {
      attempts: Math.max(1, retry),
      shouldRetry: async () => true,
    };
  }

  return {
    attempts: Math.max(1, retry?.attempts ?? 1),
    shouldRetry: retry?.shouldRetry ?? (async () => true),
  };
}

class FileWorkflowContext<TState extends JsonValue> implements WorkflowContext<TState> {
  readonly workflowId: string;
  readonly dir: string;
  readonly recordPath: string;

  constructor(private readonly store: WorkflowStore<TState>) {
    this.workflowId = store.workflowId;
    this.dir = store.dir;
    this.recordPath = store.recordPath;
  }

  async getRecord(): Promise<WorkflowRecord<TState>> {
    return this.store.read();
  }

  async updateState(updater: StateUpdater<TState>): Promise<TState> {
    return this.store.mutate((record) => {
      const next = typeof updater === 'function'
        ? (updater as (state: TState) => TState)(cloneJson(record.state))
        : updater;

      record.state = cloneJson(next);
      record.events.push({
        at: this.store.timestamp(),
        type: 'state.updated',
      });
      return cloneJson(record.state);
    });
  }

  async appendEvent<TDetail extends JsonValue = JsonValue>(input: AppendEventInput<TDetail>) {
    return this.store.mutate((record) => {
      const event = {
        at: this.store.timestamp(),
        type: input.type,
        ...(input.message ? { message: input.message } : {}),
        ...(input.detail !== undefined ? { detail: cloneJson(input.detail) } : {}),
      };
      record.events.push(event);
      return event;
    });
  }

  async heartbeat<TDetail extends JsonValue = JsonValue>(key: string, detail?: TDetail) {
    return this.store.mutate((record) => {
      const heartbeat: WorkflowHeartbeatRecord<TDetail> = {
        key,
        at: this.store.timestamp(),
        ...(detail !== undefined ? { detail: cloneJson(detail) } : {}),
      };
      record.heartbeats ??= {};
      record.heartbeats[key] = heartbeat;
      record.events.push({
        at: heartbeat.at,
        type: 'heartbeat.recorded',
        detail: {
          key,
          hasDetail: detail !== undefined,
        },
      });
      return heartbeat;
    });
  }

  async touchLease<TDetail extends JsonValue = JsonValue>(
    key: string,
    input: TouchLeaseInput<TDetail>,
  ): Promise<WorkflowLeaseRecord<TDetail>> {
    if (!input.holder.trim()) {
      throw new Error(`Lease "${key}" requires a non-empty holder`);
    }
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
      throw new Error(`Lease "${key}" requires ttlMs > 0`);
    }

    return this.store.mutate((record) => {
      const now = this.store.timestamp();
      const current = record.leases?.[key];
      const status = current ? workflowLeaseStatus(current, new Date(now)) : undefined;
      const sameHolderActive = current?.holder === input.holder && status === 'active';

      if (
        current &&
        status === 'active' &&
        current.holder !== input.holder
      ) {
        throw new WorkflowLeaseConflictError({
          leaseKey: key,
          holder: input.holder,
          currentHolder: current.holder,
          expiresAt: current.expiresAt,
        });
      }

      const heartbeatAt = now;
      const expiresAt = new Date(Date.parse(now) + input.ttlMs).toISOString();
      const detail = input.detail !== undefined
        ? cloneJson(input.detail)
        : current?.detail !== undefined
          ? cloneJson(current.detail as TDetail)
          : undefined;
      const acquiredAt = sameHolderActive && current ? current.acquiredAt : now;
      const lease: WorkflowLeaseRecord<TDetail> = sameHolderActive
        ? {
          key,
          holder: input.holder,
          acquiredAt,
          heartbeatAt,
          expiresAt,
          ...(detail !== undefined ? { detail } : {}),
        }
        : {
          key,
          holder: input.holder,
          acquiredAt,
          heartbeatAt,
          expiresAt,
          ...(detail !== undefined ? { detail } : {}),
        };

      record.leases ??= {};
      record.leases[key] = lease;
      record.events.push({
        at: now,
        type: sameHolderActive ? 'lease.renewed' : 'lease.acquired',
        detail: {
          key,
          holder: input.holder,
          ttlMs: input.ttlMs,
        },
      });
      return lease;
    });
  }

  async releaseLease(key: string, holder?: string): Promise<WorkflowLeaseRecord | undefined> {
    return this.store.mutate((record) => {
      const current = record.leases?.[key];
      if (!current) return undefined;
      if (holder !== undefined && current.holder !== holder) {
        throw new Error(`Lease "${key}" is held by "${current.holder}", not "${holder}"`);
      }
      if (current.releasedAt) return current;
      const releasedAt = this.store.timestamp();
      const lease: WorkflowLeaseRecord = {
        ...current,
        releasedAt,
      };
      record.leases ??= {};
      record.leases[key] = lease;
      record.events.push({
        at: releasedAt,
        type: 'lease.released',
        detail: {
          key,
          holder: current.holder,
        },
      });
      return lease;
    });
  }

  async setStatus(status: WorkflowStatus, error?: unknown): Promise<WorkflowRecord<TState>> {
    return this.store.mutate((record) => {
      record.status = status;
      if (error !== undefined) {
        record.lastError = serializeError(error);
      } else {
        delete record.lastError;
      }

      record.events.push({
        at: this.store.timestamp(),
        type: `workflow.${status}`,
        ...(error !== undefined && record.lastError ? { detail: { error: serializedErrorToJson(record.lastError) } } : {}),
      });

      return clone(record);
    });
  }

  async step<TResult extends JsonValue>(
    name: string,
    run: (context: StepRunContext) => Promise<TResult> | TResult,
    options: StepOptions = {},
  ): Promise<TResult> {
    const retry = normalizeRetry(options.retry);

    while (true) {
      const decision = await this.store.mutate((record) => {
        const existing = record.steps[name];
        const sameKey = existing?.idempotencyKey === options.idempotencyKey;
        const hasImplicitKey = existing?.idempotencyKey === undefined && options.idempotencyKey === undefined;

        if (existing?.status === 'completed' && (sameKey || hasImplicitKey)) {
          return {
            kind: 'cached' as const,
            result: cloneJson(existing.result as TResult),
          };
        }

        const attempt = (existing?.attempts ?? 0) + 1;
        const now = this.store.timestamp();
        record.status = 'running';
        record.steps[name] = {
          name,
          status: 'running',
          attempts: attempt,
          startedAt: now,
          updatedAt: now,
          idempotencyKey: options.idempotencyKey,
        };
        record.events.push({
          at: now,
          type: 'step.started',
          detail: {
            step: name,
            attempt,
            idempotencyKey: options.idempotencyKey ?? null,
          },
        });

        return {
          kind: 'run' as const,
          attempt,
        };
      });

      if (decision.kind === 'cached') {
        return decision.result;
      }

      try {
        const result = await run({
          attempt: decision.attempt,
          maxAttempts: retry.attempts,
        });

        await this.store.mutate((record) => {
          const step = record.steps[name];
          const now = this.store.timestamp();
          if (!step) {
            throw new Error(`Step "${name}" disappeared before completion`);
          }

          step.status = 'completed';
          step.updatedAt = now;
          step.completedAt = now;
          step.result = cloneJson(result);
          delete step.error;
          delete record.lastError;
          record.events.push({
            at: now,
            type: 'step.completed',
            detail: {
              step: name,
              attempt: step.attempts,
            },
          });
        });

        return result;
      } catch (error) {
        const shouldRetry = decision.attempt < retry.attempts
          && await retry.shouldRetry(error, {
            step: name,
            attempt: decision.attempt,
            maxAttempts: retry.attempts,
          });
        const serialized = serializeError(error);

        await this.store.mutate((record) => {
          const step = record.steps[name];
          const now = this.store.timestamp();
          if (!step) {
            throw new Error(`Step "${name}" disappeared after failure`);
          }

          step.status = 'failed';
          step.updatedAt = now;
          step.error = serialized;
          record.lastError = serialized;
          record.events.push({
            at: now,
            type: shouldRetry ? 'step.retrying' : 'step.failed',
            detail: {
              step: name,
              attempt: step.attempts,
              error: serializedErrorToJson(serialized),
            },
          });
        });

        if (!shouldRetry) throw error;
      }
    }
  }

  async withMutex<TResult>(
    key: string,
    run: () => Promise<TResult> | TResult,
    options: MutexOptions = {},
  ): Promise<TResult> {
    const lockPath = this.store.mutexPath(key);
    await acquireLock(lockPath, options);
    let value: TResult | undefined;
    let taskError: unknown;
    let releaseError: unknown;

    try {
      await this.appendEvent({
        type: 'mutex.acquired',
        detail: { key },
      });
      value = await run();
    } catch (error) {
      taskError = error;
    }

    try {
      await releaseLock(lockPath);
    } catch (error) {
      releaseError = error;
    }

    try {
      await this.appendEvent({
        type: 'mutex.released',
        detail: { key },
      });
    } catch (error) {
      if (releaseError === undefined) releaseError = error;
    }

    if (taskError !== undefined) throw taskError;
    if (releaseError !== undefined) throw releaseError;
    return value as TResult;
  }

  async forEach<TItem, TResult>(
    items: Iterable<TItem>,
    run: (item: TItem, context: { index: number }) => Promise<TResult> | TResult,
    options: ForEachOptions<TItem> = {},
  ): Promise<ForEachSummary<TResult>> {
    const list = Array.from(items);
    const maxParallel = Math.max(1, options.maxParallel ?? 1);
    const stopOnError = options.stopOnError ?? true;
    const results: PromiseSettledResult<TResult>[] = new Array(list.length);
    let next = 0;
    let firstError: unknown;

    const worker = async (): Promise<void> => {
      while (true) {
        if (stopOnError && firstError) return;
        const index = next++;
        if (index >= list.length) return;

        const item = list[index];
        const mutexKey = typeof options.mutexKey === 'function'
          ? options.mutexKey(item, index)
          : options.mutexKey;

        try {
          const value = mutexKey
            ? await this.withMutex(mutexKey, () => run(item, { index }), options.mutex)
            : await run(item, { index });

          results[index] = {
            status: 'fulfilled',
            value,
          };
        } catch (error) {
          results[index] = {
            status: 'rejected',
            reason: error,
          };
          if (stopOnError && firstError === undefined) {
            firstError = error;
          }
        }
      }
    };

    const concurrency = Math.min(maxParallel, Math.max(list.length, 1));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (firstError !== undefined) {
      throw firstError;
    }

    return {
      results,
      fulfilled: results.filter((entry) => entry?.status === 'fulfilled').length,
      rejected: results.filter((entry) => entry?.status === 'rejected').length,
    };
  }
}

export async function openWorkflow<TState extends JsonValue>(
  options: WorkflowOptions<TState>,
): Promise<WorkflowContext<TState>> {
  const store = new WorkflowStore(options);
  await store.read();
  return new FileWorkflowContext(store);
}

export async function readWorkflowRecord<TState extends JsonValue>(
  options: WorkflowOptions<TState>,
): Promise<WorkflowRecord<TState>> {
  const store = new WorkflowStore(options);
  return store.read();
}

export async function runWorkflow<TState extends JsonValue, TResult>(
  options: WorkflowOptions<TState>,
  run: (workflow: WorkflowContext<TState>) => Promise<TResult> | TResult,
): Promise<RunWorkflowResult<TState, TResult>> {
  const workflow = await openWorkflow(options);
  await workflow.setStatus('running');

  try {
    const value = await run(workflow);
    const record = await workflow.setStatus('completed');
    return { value, record };
  } catch (error) {
    await workflow.setStatus('failed', error);
    throw error;
  }
}

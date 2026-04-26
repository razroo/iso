import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { JsonObject, JsonValue, SerializedError, WorkflowRecord } from './types.js';

const RECORD_VERSION = 1;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return clone(value);
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const cause = typeof error.cause === 'string'
      ? error.cause
      : error.cause instanceof Error
        ? error.cause.message
        : undefined;

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code?: string }).code
        : undefined,
      cause,
    };
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: error };
  }

  return {
    name: 'Error',
    message: typeof error === 'undefined' ? 'undefined' : String(error),
  };
}

export function serializedErrorToJson(error: SerializedError): JsonObject {
  const detail: JsonObject = {
    name: error.name,
    message: error.message,
  };

  if (error.stack !== undefined) detail.stack = error.stack;
  if (error.code !== undefined) detail.code = error.code;
  if (error.cause !== undefined) detail.cause = error.cause;

  return detail;
}

function safeStem(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return cleaned || 'workflow';
}

export function stableKey(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function workflowFileName(workflowId: string): string {
  return `${safeStem(workflowId)}-${stableKey(workflowId).slice(0, 8)}.json`;
}

function lockName(key: string): string {
  return `${safeStem(key)}-${stableKey(key).slice(0, 8)}.lock`;
}

export interface LockOptions {
  timeoutMs?: number;
  pollMs?: number;
  staleAfterMs?: number;
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function acquireLock(lockPath: string, options: LockOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 50;
  const staleAfterMs = options.staleAfterMs;
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, 'owner.json'),
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;

      if (staleAfterMs !== undefined) {
        try {
          const info = await stat(lockPath);
          if (Date.now() - info.mtimeMs > staleAfterMs) {
            await rm(lockPath, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          const statCode = (statError as NodeJS.ErrnoException).code;
          if (statCode === 'ENOENT') continue;
          throw statError;
        }
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for lock ${lockPath}`);
      }

      await delay(pollMs);
    }
  }
}

export async function releaseLock(lockPath: string): Promise<void> {
  await rm(lockPath, { recursive: true, force: true });
}

interface WorkflowStoreOptions<TState extends JsonValue> {
  workflowId: string;
  initialState: TState;
  dir?: string;
  now?: () => Date;
}

export class WorkflowStore<TState extends JsonValue> {
  readonly workflowId: string;
  readonly dir: string;
  readonly recordPath: string;

  private readonly now: () => Date;
  private readonly initialState: TState;
  private readonly workflowLockRoot: string;
  private readonly recordLockPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: WorkflowStoreOptions<TState>) {
    this.workflowId = options.workflowId;
    this.dir = resolve(options.dir ?? '.iso-orchestrator');
    this.recordPath = join(this.dir, 'workflows', workflowFileName(options.workflowId));
    this.workflowLockRoot = join(this.dir, 'locks', workflowFileName(options.workflowId).replace(/\.json$/, ''));
    this.recordLockPath = join(this.workflowLockRoot, 'record.lock');
    this.initialState = clone(options.initialState);
    this.now = options.now ?? (() => new Date());
  }

  timestamp(): string {
    return this.now().toISOString();
  }

  mutexPath(key: string): string {
    return join(this.workflowLockRoot, 'mutex', lockName(key));
  }

  async read(): Promise<WorkflowRecord<TState>> {
    await this.queue;
    return this.withRecordLock(async () => clone(await this.loadOrCreateUnlocked()));
  }

  async mutate<TResult>(mutator: (record: WorkflowRecord<TState>) => Promise<TResult> | TResult): Promise<TResult> {
    const run = async (): Promise<TResult> => this.withRecordLock(async () => {
      const record = await this.loadOrCreateUnlocked();
      const result = await mutator(record);
      record.updatedAt = this.timestamp();
      await this.saveUnlocked(record);
      return result;
    });

    const pending = this.queue.then(run, run);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async withRecordLock<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    await mkdir(this.workflowLockRoot, { recursive: true });
    await acquireLock(this.recordLockPath, { timeoutMs: 30_000, pollMs: 25, staleAfterMs: 60_000 });
    try {
      return await run();
    } finally {
      await releaseLock(this.recordLockPath);
    }
  }

  private async loadOrCreateUnlocked(): Promise<WorkflowRecord<TState>> {
    await mkdir(dirname(this.recordPath), { recursive: true });

    try {
      const raw = await readFile(this.recordPath, 'utf8');
      return JSON.parse(raw) as WorkflowRecord<TState>;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;

      const now = this.timestamp();
      const record: WorkflowRecord<TState> = {
        version: RECORD_VERSION,
        workflowId: this.workflowId,
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        state: clone(this.initialState),
        steps: {},
        events: [],
      };

      await this.saveUnlocked(record);
      return record;
    }
  }

  private async saveUnlocked(record: WorkflowRecord<TState>): Promise<void> {
    const tmpPath = `${this.recordPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.recordPath);
  }
}

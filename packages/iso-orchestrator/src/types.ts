export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type WorkflowStatus = 'idle' | 'running' | 'completed' | 'failed';
export type StepStatus = 'running' | 'completed' | 'failed';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: string;
}

export interface WorkflowEvent<TDetail extends JsonValue = JsonValue> {
  at: string;
  type: string;
  message?: string;
  detail?: TDetail;
}

export interface AppendEventInput<TDetail extends JsonValue = JsonValue> {
  type: string;
  message?: string;
  detail?: TDetail;
}

export interface StepRecord<TResult extends JsonValue = JsonValue> {
  name: string;
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  idempotencyKey?: string;
  result?: TResult;
  error?: SerializedError;
}

export interface WorkflowRecord<TState extends JsonValue = JsonValue> {
  version: 1;
  workflowId: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  state: TState;
  steps: Record<string, StepRecord>;
  events: WorkflowEvent[];
  lastError?: SerializedError;
}

export interface WorkflowOptions<TState extends JsonValue> {
  workflowId: string;
  initialState: TState;
  dir?: string;
  now?: () => Date;
}

export type StateUpdater<TState extends JsonValue> = TState | ((state: TState) => TState);

export interface RetryContext {
  step: string;
  attempt: number;
  maxAttempts: number;
}

export interface RetryPolicy {
  attempts?: number;
  shouldRetry?: (error: unknown, context: RetryContext) => boolean | Promise<boolean>;
}

export interface StepOptions {
  idempotencyKey?: string;
  retry?: number | RetryPolicy;
}

export interface StepRunContext {
  attempt: number;
  maxAttempts: number;
}

export interface MutexOptions {
  timeoutMs?: number;
  pollMs?: number;
  staleAfterMs?: number;
}

export interface ForEachContext {
  index: number;
}

export interface ForEachOptions<TItem> {
  maxParallel?: number;
  mutexKey?: string | ((item: TItem, index: number) => string | undefined);
  stopOnError?: boolean;
  mutex?: MutexOptions;
}

export interface ForEachSummary<TResult> {
  results: PromiseSettledResult<TResult>[];
  fulfilled: number;
  rejected: number;
}

export interface RunWorkflowResult<TState extends JsonValue, TResult> {
  value: TResult;
  record: WorkflowRecord<TState>;
}

export interface WorkflowContext<TState extends JsonValue> {
  readonly workflowId: string;
  readonly dir: string;
  readonly recordPath: string;
  getRecord(): Promise<WorkflowRecord<TState>>;
  updateState(updater: StateUpdater<TState>): Promise<TState>;
  appendEvent<TDetail extends JsonValue = JsonValue>(input: AppendEventInput<TDetail>): Promise<WorkflowEvent<TDetail>>;
  setStatus(status: WorkflowStatus, error?: unknown): Promise<WorkflowRecord<TState>>;
  step<TResult extends JsonValue>(
    name: string,
    run: (context: StepRunContext) => Promise<TResult> | TResult,
    options?: StepOptions,
  ): Promise<TResult>;
  withMutex<TResult>(
    key: string,
    run: () => Promise<TResult> | TResult,
    options?: MutexOptions,
  ): Promise<TResult>;
  forEach<TItem, TResult>(
    items: Iterable<TItem>,
    run: (item: TItem, context: ForEachContext) => Promise<TResult> | TResult,
    options?: ForEachOptions<TItem>,
  ): Promise<ForEachSummary<TResult>>;
}

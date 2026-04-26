export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface LedgerEvent {
  id: string;
  type: string;
  at: string;
  key?: string;
  subject?: string;
  idempotencyKey?: string;
  data: JsonObject;
  meta: JsonObject;
}

export interface LedgerEventInput {
  id?: string;
  type: string;
  at?: string;
  key?: string;
  subject?: string;
  idempotencyKey?: string;
  data?: JsonObject;
  meta?: JsonObject;
}

export interface LedgerOptions {
  path?: string;
  dir?: string;
}

export interface AppendEventResult {
  event: LedgerEvent;
  appended: boolean;
  duplicateOf?: string;
}

export interface QueryOptions {
  type?: string;
  key?: string;
  subject?: string;
  where?: Record<string, JsonPrimitive>;
  limit?: number;
}

export type IssueSeverity = "error" | "warn";

export interface VerifyIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  line?: number;
  eventId?: string;
}

export interface VerifyResult {
  ok: boolean;
  eventCount: number;
  errors: number;
  warnings: number;
  issues: VerifyIssue[];
}

export interface MaterializedEntity {
  subject: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  eventCount: number;
  eventIds: string[];
  lastEventType: string;
  data: JsonObject;
}

export interface MaterializedLedger {
  generatedAt: string;
  eventCount: number;
  entityCount: number;
  entities: Record<string, MaterializedEntity>;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface CacheKeyInput {
  namespace?: string;
  version?: string;
  parts?: JsonValue;
}

export interface CachePutOptions {
  kind?: string;
  contentType?: string;
  metadata?: JsonObject;
  ttlMs?: number;
  expiresAt?: string;
  now?: string | Date;
}

export interface CacheReadOptions {
  allowExpired?: boolean;
  now?: string | Date;
}

export interface CacheListOptions {
  kind?: string;
  includeExpired?: boolean;
  now?: string | Date;
}

export interface CachePruneOptions {
  expired?: boolean;
  dryRun?: boolean;
  now?: string | Date;
}

export interface CacheEntry {
  schemaVersion: 1;
  key: string;
  id: string;
  kind?: string;
  contentHash: string;
  objectPath: string;
  bytes: number;
  chars: number;
  encoding: "utf8";
  contentType?: string;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface CacheContentHit {
  hit: boolean;
  stale: boolean;
  entry?: CacheEntry;
  content?: string;
}

export type CacheIssueKind =
  | "entry-read-error"
  | "entry-schema-error"
  | "missing-object"
  | "object-hash-mismatch"
  | "expired-entry";

export interface CacheIssue {
  kind: CacheIssueKind;
  severity: "error" | "warn";
  message: string;
  entryId?: string;
  key?: string;
  path?: string;
}

export interface CacheVerifyResult {
  ok: boolean;
  root: string;
  entries: number;
  objects: number;
  issues: CacheIssue[];
}

export interface CachePruneResult {
  root: string;
  dryRun: boolean;
  removedEntries: string[];
  removedObjects: string[];
}

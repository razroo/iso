import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { isJsonObject, isJsonValue, stableStringify } from "./json.js";
import type {
  CacheContentHit,
  CacheEntry,
  CacheIssue,
  CacheKeyInput,
  CacheListOptions,
  CachePruneOptions,
  CachePruneResult,
  CachePutOptions,
  CacheReadOptions,
  CacheVerifyResult,
  JsonObject,
} from "./types.js";

export const DEFAULT_CACHE_DIR = ".iso-cache";

export function resolveCacheDir(cacheDir = DEFAULT_CACHE_DIR): string {
  return resolve(cacheDir);
}

export function cacheKey(input: string | CacheKeyInput): string {
  if (typeof input === "string") {
    if (!input.trim()) throw new Error("cache key must not be empty");
    return input.trim();
  }
  const namespace = (input.namespace || "cache").trim();
  if (!namespace) throw new Error("cache key namespace must not be empty");
  const version = input.version?.trim();
  const payload: { namespace: string; parts: JsonObject[keyof JsonObject]; version?: string } = {
    namespace,
    parts: input.parts ?? [],
  };
  if (version) payload.version = version;
  return `${namespace}:${sha256(stableStringify(payload))}`;
}

export function cacheEntryId(key: string): string {
  return sha256(cacheKey(key));
}

export function hashContent(content: string): string {
  return `sha256:${sha256(content)}`;
}

export function putCacheEntry(
  cacheDir: string,
  keyInput: string,
  content: string,
  options: CachePutOptions = {},
): CacheEntry {
  const root = resolveCacheDir(cacheDir);
  ensureCacheDirs(root);

  const key = cacheKey(keyInput);
  const id = cacheEntryId(key);
  const now = isoNow(options.now);
  const contentHash = hashContent(content);
  const hashHex = contentHash.slice("sha256:".length);
  const objectPath = join("objects", `${hashHex}.blob`);
  const absoluteObjectPath = join(root, objectPath);
  const existing = readCacheEntry(root, key, { allowExpired: true });
  const entry: CacheEntry = {
    schemaVersion: 1,
    key,
    id,
    kind: normalizeOptionalString(options.kind, "kind"),
    contentHash,
    objectPath,
    bytes: Buffer.byteLength(content, "utf8"),
    chars: content.length,
    encoding: "utf8",
    contentType: normalizeOptionalString(options.contentType, "contentType"),
    metadata: normalizeMetadata(options.metadata),
    createdAt: existing?.entry?.createdAt || now,
    updatedAt: now,
    expiresAt: resolveExpiresAt(options, now),
  };

  writeFileSync(absoluteObjectPath, content, "utf8");
  writeJsonAtomic(entryPath(root, id), entry);
  return entry;
}

export function readCacheEntry(
  cacheDir: string,
  keyInput: string,
  options: CacheReadOptions = {},
): CacheContentHit | undefined {
  const root = resolveCacheDir(cacheDir);
  const key = cacheKey(keyInput);
  const path = entryPath(root, cacheEntryId(key));
  if (!existsSync(path)) return undefined;
  const entry = parseCacheEntry(readFileSync(path, "utf8"), path);
  const stale = isExpired(entry, options.now);
  if (stale && !options.allowExpired) return { hit: false, stale, entry };
  return { hit: true, stale, entry };
}

export function readCacheContent(
  cacheDir: string,
  keyInput: string,
  options: CacheReadOptions = {},
): CacheContentHit | undefined {
  const hit = readCacheEntry(cacheDir, keyInput, options);
  if (!hit?.hit || !hit.entry) return hit;
  const root = resolveCacheDir(cacheDir);
  const absoluteObjectPath = resolveObjectPath(root, hit.entry);
  if (!existsSync(absoluteObjectPath)) {
    return { hit: false, stale: hit.stale, entry: hit.entry };
  }
  const content = readFileSync(absoluteObjectPath, "utf8");
  return { ...hit, content };
}

export function hasCacheEntry(cacheDir: string, keyInput: string, options: CacheReadOptions = {}): boolean {
  return Boolean(readCacheEntry(cacheDir, keyInput, options)?.hit);
}

export function listCacheEntries(cacheDir: string, options: CacheListOptions = {}): CacheEntry[] {
  const root = resolveCacheDir(cacheDir);
  const entriesDir = join(root, "entries");
  if (!existsSync(entriesDir)) return [];
  const entries = readdirSync(entriesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => parseCacheEntry(readFileSync(join(entriesDir, file), "utf8"), join(entriesDir, file)))
    .filter((entry) => !options.kind || entry.kind === options.kind)
    .filter((entry) => options.includeExpired || !isExpired(entry, options.now));
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export function verifyCache(cacheDir: string, options: { now?: string | Date } = {}): CacheVerifyResult {
  const root = resolveCacheDir(cacheDir);
  const issues: CacheIssue[] = [];
  const entriesDir = join(root, "entries");
  const objectsDir = join(root, "objects");
  let entries = 0;

  if (existsSync(entriesDir)) {
    for (const file of readdirSync(entriesDir).filter((name) => name.endsWith(".json"))) {
      const path = join(entriesDir, file);
      try {
        const entry = parseCacheEntry(readFileSync(path, "utf8"), path);
        entries++;
        if (isExpired(entry, options.now)) {
          issues.push({
            kind: "expired-entry",
            severity: "warn",
            key: entry.key,
            entryId: entry.id,
            path,
            message: `cache entry "${entry.key}" is expired`,
          });
        }
        const objectPath = resolveObjectPath(root, entry);
        if (!existsSync(objectPath)) {
          issues.push({
            kind: "missing-object",
            severity: "error",
            key: entry.key,
            entryId: entry.id,
            path: objectPath,
            message: `cache object for "${entry.key}" is missing`,
          });
          continue;
        }
        const content = readFileSync(objectPath, "utf8");
        const actualHash = hashContent(content);
        if (actualHash !== entry.contentHash) {
          issues.push({
            kind: "object-hash-mismatch",
            severity: "error",
            key: entry.key,
            entryId: entry.id,
            path: objectPath,
            message: `cache object hash mismatch for "${entry.key}"`,
          });
        }
      } catch (error) {
        issues.push({
          kind: error instanceof CacheSchemaError ? "entry-schema-error" : "entry-read-error",
          severity: "error",
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    root,
    entries,
    objects: countObjectFiles(objectsDir),
    issues,
  };
}

export function pruneCache(cacheDir: string, options: CachePruneOptions = {}): CachePruneResult {
  const root = resolveCacheDir(cacheDir);
  const dryRun = Boolean(options.dryRun);
  const pruneExpired = options.expired !== false;
  const removedEntries: string[] = [];
  const removedObjects: string[] = [];
  const entriesDir = join(root, "entries");
  const objectsDir = join(root, "objects");

  if (!existsSync(entriesDir)) return { root, dryRun, removedEntries, removedObjects };

  for (const file of readdirSync(entriesDir).filter((name) => name.endsWith(".json"))) {
    const path = join(entriesDir, file);
    const entry = parseCacheEntry(readFileSync(path, "utf8"), path);
    if (pruneExpired && isExpired(entry, options.now)) {
      removedEntries.push(path);
      if (!dryRun) rmSync(path, { force: true });
    }
  }

  const referenced = new Set(
    listCacheEntries(root, { includeExpired: true }).map((entry) => resolveObjectPath(root, entry)),
  );
  for (const objectPath of listObjectFiles(objectsDir)) {
    if (!referenced.has(objectPath)) {
      removedObjects.push(objectPath);
      if (!dryRun) rmSync(objectPath, { force: true });
    }
  }

  return { root, dryRun, removedEntries, removedObjects };
}

export function isExpired(entry: CacheEntry, now: string | Date = new Date()): boolean {
  if (!entry.expiresAt) return false;
  return new Date(entry.expiresAt).getTime() <= toDate(now).getTime();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function ensureCacheDirs(root: string): void {
  mkdirSync(join(root, "entries"), { recursive: true });
  mkdirSync(join(root, "objects"), { recursive: true });
}

function entryPath(root: string, id: string): string {
  return join(root, "entries", `${id}.json`);
}

function resolveObjectPath(root: string, entry: CacheEntry): string {
  const absolute = resolve(root, entry.objectPath);
  if (!absolute.startsWith(root)) throw new Error(`cache object path escapes root: ${entry.objectPath}`);
  return absolute;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function parseCacheEntry(text: string, label: string): CacheEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CacheSchemaError(`${label}: invalid JSON: ${detail}`);
  }
  if (!isJsonObject(parsed)) throw new CacheSchemaError(`${label}: cache entry must be an object`);
  if (parsed.schemaVersion !== 1) throw new CacheSchemaError(`${label}: unsupported schemaVersion`);
  const key = requireString(parsed.key, `${label}.key`);
  const id = requireString(parsed.id, `${label}.id`);
  const contentHash = requireString(parsed.contentHash, `${label}.contentHash`);
  const objectPath = requireString(parsed.objectPath, `${label}.objectPath`);
  const encoding = requireString(parsed.encoding, `${label}.encoding`);
  if (encoding !== "utf8") throw new CacheSchemaError(`${label}.encoding must be utf8`);
  const metadata = parsed.metadata === undefined ? {} : parsed.metadata;
  if (!isJsonObject(metadata) || !isJsonValue(metadata)) {
    throw new CacheSchemaError(`${label}.metadata must be a JSON object`);
  }
  const entry: CacheEntry = {
    schemaVersion: 1,
    key,
    id,
    kind: optionalString(parsed.kind, `${label}.kind`),
    contentHash,
    objectPath,
    bytes: requireNonNegativeInteger(parsed.bytes, `${label}.bytes`),
    chars: requireNonNegativeInteger(parsed.chars, `${label}.chars`),
    encoding,
    contentType: optionalString(parsed.contentType, `${label}.contentType`),
    metadata: metadata as JsonObject,
    createdAt: requireIsoString(parsed.createdAt, `${label}.createdAt`),
    updatedAt: requireIsoString(parsed.updatedAt, `${label}.updatedAt`),
    expiresAt: optionalIsoString(parsed.expiresAt, `${label}.expiresAt`),
  };
  if (entry.id !== cacheEntryId(entry.key)) {
    throw new CacheSchemaError(`${label}.id does not match sha256(key)`);
  }
  return entry;
}

function normalizeMetadata(value: JsonObject | undefined): JsonObject {
  if (value === undefined) return {};
  if (!isJsonObject(value) || !isJsonValue(value)) throw new Error("metadata must be a JSON object");
  return value;
}

function normalizeOptionalString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be empty`);
  return trimmed;
}

function resolveExpiresAt(options: CachePutOptions, nowIso: string): string | undefined {
  if (options.expiresAt && options.ttlMs !== undefined) {
    throw new Error("expiresAt and ttlMs are mutually exclusive");
  }
  if (options.expiresAt) return requireIsoString(options.expiresAt, "expiresAt");
  if (options.ttlMs === undefined) return undefined;
  if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0) throw new Error("ttlMs must be a positive integer");
  return new Date(new Date(nowIso).getTime() + options.ttlMs).toISOString();
}

function isoNow(value: string | Date | undefined): string {
  return toDate(value ?? new Date()).toISOString();
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${String(value)}`);
  return date;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CacheSchemaError(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new CacheSchemaError(`${label} must be a non-empty string`);
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new CacheSchemaError(`${label} must be a non-negative integer`);
  return Number(value);
}

function requireIsoString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (Number.isNaN(new Date(text).getTime())) throw new CacheSchemaError(`${label} must be an ISO date`);
  return new Date(text).toISOString();
}

function optionalIsoString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireIsoString(value, label);
}

function countObjectFiles(objectsDir: string): number {
  return listObjectFiles(objectsDir).length;
}

function listObjectFiles(objectsDir: string): string[] {
  if (!existsSync(objectsDir)) return [];
  return readdirSync(objectsDir)
    .map((file) => join(objectsDir, file))
    .filter((path) => statSync(path).isFile());
}

class CacheSchemaError extends Error {}

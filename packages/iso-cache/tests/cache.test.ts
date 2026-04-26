import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cacheEntryId,
  cacheKey,
  hasCacheEntry,
  hashContent,
  listCacheEntries,
  pruneCache,
  putCacheEntry,
  readCacheContent,
  verifyCache,
} from "../src/index.js";

function withCache(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-cache-"));
  try {
    run(join(dir, ".iso-cache"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("stores and reads content-addressed cache entries", () => {
  withCache((cacheDir) => {
    const key = "jd:https://example.test/jobs/123";
    const content = "# Example job\n";
    const entry = putCacheEntry(cacheDir, key, content, {
      kind: "jd",
      contentType: "text/markdown",
      metadata: { url: "https://example.test/jobs/123" },
      now: "2026-04-26T00:00:00.000Z",
    });

    assert.equal(entry.id, cacheEntryId(key));
    assert.equal(entry.contentHash, hashContent(content));
    assert.equal(entry.bytes, Buffer.byteLength(content, "utf8"));
    assert.equal(hasCacheEntry(cacheDir, key), true);

    const hit = readCacheContent(cacheDir, key);
    assert.equal(hit?.hit, true);
    assert.equal(hit?.stale, false);
    assert.equal(hit?.content, content);
    assert.equal(hit?.entry?.metadata.url, "https://example.test/jobs/123");
  });
});

test("stable cache keys are deterministic", () => {
  const a = cacheKey({
    namespace: "jobforge.jd",
    version: "v1",
    parts: { url: "https://example.test/jobs/123", strategy: "text" },
  });
  const b = cacheKey({
    namespace: "jobforge.jd",
    version: "v1",
    parts: { strategy: "text", url: "https://example.test/jobs/123" },
  });
  assert.equal(a, b);
  assert.match(a, /^jobforge\.jd:[a-f0-9]{64}$/);
});

test("expired entries are misses unless allowExpired is set", () => {
  withCache((cacheDir) => {
    putCacheEntry(cacheDir, "scan:acme", "{}", {
      kind: "scan",
      ttlMs: 1000,
      now: "2026-04-26T00:00:00.000Z",
    });

    assert.equal(hasCacheEntry(cacheDir, "scan:acme", { now: "2026-04-26T00:00:00.500Z" }), true);
    assert.equal(hasCacheEntry(cacheDir, "scan:acme", { now: "2026-04-26T00:00:02.000Z" }), false);
    assert.equal(hasCacheEntry(cacheDir, "scan:acme", {
      now: "2026-04-26T00:00:02.000Z",
      allowExpired: true,
    }), true);
  });
});

test("lists, verifies, and prunes expired entries plus orphan objects", () => {
  withCache((cacheDir) => {
    const fresh = putCacheEntry(cacheDir, "fresh", "fresh", { kind: "jd" });
    const expired = putCacheEntry(cacheDir, "expired", "expired", {
      kind: "jd",
      ttlMs: 1,
      now: "2026-04-26T00:00:00.000Z",
    });

    assert.deepEqual(listCacheEntries(cacheDir, {
      kind: "jd",
      includeExpired: true,
    }).map((entry) => entry.key), ["expired", "fresh"]);
    assert.deepEqual(listCacheEntries(cacheDir, {
      kind: "jd",
      now: "2026-04-26T00:00:01.000Z",
    }).map((entry) => entry.key), ["fresh"]);

    const verify = verifyCache(cacheDir, { now: "2026-04-26T00:00:01.000Z" });
    assert.equal(verify.ok, true);
    assert.equal(verify.issues[0]?.kind, "expired-entry");

    const result = pruneCache(cacheDir, { now: "2026-04-26T00:00:01.000Z" });
    assert.equal(result.removedEntries.length, 1);
    assert.equal(result.removedObjects.length, 1);
    assert.equal(hasCacheEntry(cacheDir, fresh.key), true);
    assert.equal(hasCacheEntry(cacheDir, expired.key, { allowExpired: true }), false);
    assert.equal(existsSync(join(cacheDir, fresh.objectPath)), true);
    assert.equal(existsSync(join(cacheDir, expired.objectPath)), false);
  });
});

test("verify fails when object content is mutated", () => {
  withCache((cacheDir) => {
    const entry = putCacheEntry(cacheDir, "key", "original");
    const objectPath = join(cacheDir, entry.objectPath);
    assert.equal(readFileSync(objectPath, "utf8"), "original");
    putCacheEntry(cacheDir, "other", "other");
    rmSync(objectPath);

    const result = verifyCache(cacheDir);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.kind === "missing-object"), true);
  });
});

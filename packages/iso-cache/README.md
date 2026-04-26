# @razroo/iso-cache

Deterministic local artifact cache for AI-agent workflows.

`iso-cache` stores UTF-8 artifacts under content-addressed blobs and small
entry manifests. It is intentionally not an MCP server and makes no model
calls. Domain packages can use it to avoid repeatedly refetching or
re-rendering artifacts that are safe to reuse:

- job-description snapshots by URL + fetch strategy
- portal scan responses by company/query/TTL
- rendered context bundles
- evaluation input bundles
- normalized page snapshots where the caller controls staleness

Do not use it for live form submission state or anything whose reuse could
repeat a side effect.

## CLI

```bash
iso-cache key --namespace job --part https://example.test/jobs/123 --part greenhouse

iso-cache put "jd:example:123" \
  --cache .iso-cache \
  --kind jd \
  --ttl 7d \
  --content-type text/markdown \
  --meta '{"url":"https://example.test/jobs/123"}' \
  --input @job-description.md

iso-cache has "jd:example:123" --cache .iso-cache
iso-cache get "jd:example:123" --cache .iso-cache
iso-cache list --cache .iso-cache --kind jd
iso-cache verify --cache .iso-cache
iso-cache prune --cache .iso-cache --expired
```

Default cache path is `.iso-cache` under the current directory.

## Library

```ts
import {
  cacheKey,
  hasCacheEntry,
  listCacheEntries,
  putCacheEntry,
  readCacheContent,
  verifyCache,
} from "@razroo/iso-cache";

const key = cacheKey({
  namespace: "jobforge.jd",
  parts: ["https://example.test/jobs/123", "geometra-text-v1"],
});

putCacheEntry(".iso-cache", key, "# Example role\n", {
  kind: "jd",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  metadata: { url: "https://example.test/jobs/123" },
});

const hit = readCacheContent(".iso-cache", key);
if (hit?.hit && !hit.stale) {
  console.log(hit.content);
}

console.log(hasCacheEntry(".iso-cache", key));
console.log(listCacheEntries(".iso-cache", { kind: "jd" }));
console.log(verifyCache(".iso-cache").ok);
```

## On-disk format

```text
.iso-cache/
  entries/
    <sha256(key)>.json
  objects/
    <sha256(content)>.blob
```

Entry files include the logical key, kind, content hash, object path,
content type, metadata, creation/update timestamps, and optional
expiration timestamp. Object blobs are immutable and verified by SHA-256.

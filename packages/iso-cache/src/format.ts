import { isExpired } from "./cache.js";
import type { CacheEntry, CacheIssue, CachePruneResult, CacheVerifyResult } from "./types.js";

export function formatCacheEntry(entry: CacheEntry): string {
  const lines = [
    `key: ${entry.key}`,
    `id: ${entry.id}`,
    `hash: ${entry.contentHash}`,
    `bytes: ${entry.bytes}`,
    `updatedAt: ${entry.updatedAt}`,
  ];
  if (entry.kind) lines.push(`kind: ${entry.kind}`);
  if (entry.contentType) lines.push(`contentType: ${entry.contentType}`);
  if (entry.expiresAt) lines.push(`expiresAt: ${entry.expiresAt}`);
  if (Object.keys(entry.metadata).length) lines.push(`metadata: ${JSON.stringify(entry.metadata)}`);
  return lines.join("\n");
}

export function formatCacheEntries(entries: CacheEntry[]): string {
  if (!entries.length) return "iso-cache: no entries";
  return entries.map((entry) => {
    const stale = isExpired(entry) ? " stale" : "";
    const kind = entry.kind ? ` kind=${entry.kind}` : "";
    return `${entry.key}${kind}${stale} ${entry.bytes}B ${entry.contentHash}`;
  }).join("\n");
}

export function formatVerifyResult(result: CacheVerifyResult): string {
  const lines = [
    `iso-cache: ${result.ok ? "PASS" : "FAIL"} (${result.entries} entries, ${result.objects} objects)`,
    `root: ${result.root}`,
  ];
  if (result.issues.length) {
    lines.push("");
    lines.push("issues:");
    for (const issue of result.issues) lines.push(`  ${formatCacheIssue(issue)}`);
  }
  return lines.join("\n");
}

export function formatCacheIssue(issue: CacheIssue): string {
  const key = issue.key ? ` ${issue.key}` : "";
  const path = issue.path ? ` (${issue.path})` : "";
  return `${issue.severity} ${issue.kind}${key}: ${issue.message}${path}`;
}

export function formatPruneResult(result: CachePruneResult): string {
  const lines = [
    `iso-cache: ${result.dryRun ? "would prune" : "pruned"} ${result.removedEntries.length} entries, ${result.removedObjects.length} objects`,
    `root: ${result.root}`,
  ];
  if (result.removedEntries.length) {
    lines.push("");
    lines.push("entries:");
    for (const path of result.removedEntries) lines.push(`  - ${path}`);
  }
  if (result.removedObjects.length) {
    lines.push("");
    lines.push("objects:");
    for (const path of result.removedObjects) lines.push(`  - ${path}`);
  }
  return lines.join("\n");
}

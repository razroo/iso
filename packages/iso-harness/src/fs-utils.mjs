import { promises as fs } from 'node:fs';
import path from 'node:path';

// `dryRun` short-circuits the actual filesystem write so callers can still
// accumulate the "what would be emitted" list without touching disk. The
// return value reports bytes for dry-run summary display.
export async function writeFile(filePath, content, { dryRun = false } = {}) {
  const bytes = Buffer.byteLength(content);
  if (dryRun) return { bytes, wrote: false };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return { bytes, wrote: true };
}

export async function writeJson(filePath, obj, opts) {
  return writeFile(filePath, JSON.stringify(obj, null, 2) + '\n', opts);
}

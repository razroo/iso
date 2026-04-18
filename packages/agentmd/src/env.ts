import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env parser. Handles:
//   KEY=value
//   KEY="value with spaces"
//   KEY='value with spaces'
//   # comments (whole-line only)
// Blank lines and lines without '=' are ignored. Values already present in
// process.env win — we never overwrite an explicit export.
export function loadDotEnv(cwd: string = process.cwd()): string[] {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return [];
  const loaded: string[] = [];
  const source = readFileSync(path, "utf8");
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

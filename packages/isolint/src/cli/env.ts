import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tiny .env loader. Intentionally dependency-free; only parses simple
 * KEY=VALUE lines (no interpolation, no multiline).
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, ".env");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

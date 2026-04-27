import type { JsonArray, JsonObject, JsonValue } from "./types.js";

export function parseJson(text: string, source = "JSON"): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new Error(`${source}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseJsonLines(text: string, source = "JSONL"): JsonValue[] {
  const values: JsonValue[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim();
    if (!line) continue;
    values.push(parseJson(line, `${source}:${index + 1}`));
  }
  return values;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return Number.isFinite(value as number) || typeof value !== "number";
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isJsonObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isJsonObject(value)) {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) out[key] = sortJson(value[key] as JsonValue);
    return out;
  }
  return value;
}

export function toJsonValue(value: unknown): JsonValue {
  if (isJsonValue(value)) return value;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJsonValue(item);
    return out;
  }
  return String(value);
}

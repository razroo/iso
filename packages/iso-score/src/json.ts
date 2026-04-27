import type { JsonArray, JsonObject, JsonValue } from "./types.js";

export function parseJson(text: string, source = "<input>"): JsonValue {
  try {
    const value = JSON.parse(text) as unknown;
    if (!isJsonValue(value)) throw new Error("value is not JSON");
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${source}: invalid JSON: ${detail}`);
  }
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value) && value.every(isJsonValue);
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
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

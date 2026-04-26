import type { JsonObject, JsonValue } from "./types.js";

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isJsonObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

export function parseJson(raw: string, where: string): JsonValue {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isJsonValue(parsed)) throw new Error("value is not JSON-serializable");
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${where}: invalid JSON: ${message}`);
  }
}

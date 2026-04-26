import { createHash } from "node:crypto";
import type { JsonObject, JsonPrimitive, JsonValue } from "./types.js";

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function hashJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseJsonObject(raw: string, where: string): JsonObject {
  const parsed = parseJson(raw, where);
  if (!isJsonObject(parsed)) throw new Error(`${where}: expected a JSON object`);
  return parsed;
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

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value) || typeof value !== "number";
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isJsonObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

export function fieldValue(source: JsonObject, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function valuesEqual(actual: unknown, expected: JsonPrimitive): boolean {
  if (actual === expected) return true;
  if (actual === undefined) return false;
  return String(actual) === String(expected);
}

export function mergeJsonObject(base: JsonObject, next: JsonObject): JsonObject {
  return { ...base, ...next };
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isJsonObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortJson(value[key] as JsonValue);
  }
  return out;
}

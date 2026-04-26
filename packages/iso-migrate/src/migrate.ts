import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { cloneJson, isJsonObject, isJsonValue, parseJson, stableStringify } from "./json.js";
import type {
  EnsureLinesOperation,
  JsonMergeOperation,
  JsonObject,
  JsonSetOperation,
  JsonValue,
  Migration,
  MigrationConfig,
  MigrationOperation,
  MigrationResult,
  MigrationRunResult,
  OperationResult,
  ReplaceOperation,
  RunMigrationsOptions,
  WriteFileOperation,
} from "./types.js";

export function loadMigrationConfig(input: unknown): MigrationConfig {
  if (!isJsonObject(input)) throw new Error("migration config must be an object");
  if (input.version !== 1) throw new Error("migration config version must be 1");
  if (!Array.isArray(input.migrations)) throw new Error("migration config migrations must be an array");
  return {
    version: 1,
    migrations: input.migrations.map((migration, index) => normalizeMigration(migration, `migrations[${index}]`)),
  };
}

export function runMigrations(configInput: MigrationConfig | unknown, options: RunMigrationsOptions = {}): MigrationRunResult {
  const config = loadMigrationConfig(configInput);
  const root = resolve(options.root || ".");
  const dryRun = options.dryRun !== false;
  const migrations: MigrationResult[] = [];

  for (const migration of config.migrations) {
    const operations = migration.operations.map((operation) => runOperation(root, migration.id, operation, dryRun));
    migrations.push({
      id: migration.id,
      description: migration.description,
      changed: operations.some((operation) => operation.changed),
      operations,
    });
  }

  const changeCount = migrations.reduce(
    (total, migration) => total + migration.operations.filter((operation) => operation.changed).length,
    0,
  );
  return {
    root,
    dryRun,
    changed: changeCount > 0,
    changeCount,
    migrations,
  };
}

function runOperation(root: string, migrationId: string, operation: MigrationOperation, dryRun: boolean): OperationResult {
  if (operation.type === "ensure-lines") return runEnsureLines(root, migrationId, operation, dryRun);
  if (operation.type === "json-set") return runJsonSet(root, migrationId, operation, dryRun);
  if (operation.type === "json-merge") return runJsonMerge(root, migrationId, operation, dryRun);
  if (operation.type === "replace") return runReplace(root, migrationId, operation, dryRun);
  if (operation.type === "write-file") return runWriteFile(root, migrationId, operation, dryRun);
  throw new Error(`unsupported operation type: ${(operation as { type?: unknown }).type}`);
}

function runEnsureLines(root: string, migrationId: string, operation: EnsureLinesOperation, dryRun: boolean): OperationResult {
  const path = resolveInside(root, operation.path);
  if (!existsSync(path) && operation.create === false) {
    throw new Error(`${operation.path}: file does not exist and create=false`);
  }
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = splitTextLines(original);
  const missing = operation.lines.filter((line) => !lines.includes(line));
  if (!missing.length) return unchanged(migrationId, operation, "all lines already present");

  const nextLines = [...lines];
  if (nextLines.length === 1 && nextLines[0] === "") nextLines.length = 0;
  const beforeIndex = operation.before === undefined ? -1 : nextLines.indexOf(operation.before);
  const afterIndex = operation.after === undefined ? -1 : nextLines.indexOf(operation.after);
  if (beforeIndex >= 0) nextLines.splice(beforeIndex, 0, ...missing);
  else if (afterIndex >= 0) nextLines.splice(afterIndex + 1, 0, ...missing);
  else nextLines.push(...missing);

  if (!dryRun) writeTextFile(path, `${nextLines.join("\n")}\n`);
  return changed(migrationId, operation, `ensure ${missing.length} line(s)`);
}

function runJsonSet(root: string, migrationId: string, operation: JsonSetOperation, dryRun: boolean): OperationResult {
  const { path, doc } = readJsonDocument(root, operation.path, operation.create === true);
  const next = setJsonPointer(doc, operation.pointer, cloneJson(operation.value));
  if (stableStringify(doc) === stableStringify(next)) return unchanged(migrationId, operation, "value already set");
  if (!dryRun) writeJsonFile(path, next);
  return changed(migrationId, operation, `set ${operation.pointer || "/"}`);
}

function runJsonMerge(root: string, migrationId: string, operation: JsonMergeOperation, dryRun: boolean): OperationResult {
  const { path, doc } = readJsonDocument(root, operation.path, operation.create === true);
  const existing = getJsonPointer(doc, operation.pointer);
  if (existing !== undefined && !isJsonObject(existing)) {
    throw new Error(`${operation.path}: ${operation.pointer || "/"} must be an object for json-merge`);
  }
  const merged = deepMerge(isJsonObject(existing) ? existing : {}, operation.value);
  const next = setJsonPointer(doc, operation.pointer, merged);
  if (stableStringify(doc) === stableStringify(next)) return unchanged(migrationId, operation, "object already merged");
  if (!dryRun) writeJsonFile(path, next);
  return changed(migrationId, operation, `merge ${operation.pointer || "/"}`);
}

function runReplace(root: string, migrationId: string, operation: ReplaceOperation, dryRun: boolean): OperationResult {
  const path = resolveInside(root, operation.path);
  if (!existsSync(path)) throw new Error(`${operation.path}: file does not exist`);
  const original = readFileSync(path, "utf8");
  if (!original.includes(operation.search)) {
    if (operation.required) throw new Error(`${operation.path}: search text not found`);
    return unchanged(migrationId, operation, "search text not found");
  }
  const next = operation.all === false
    ? original.replace(operation.search, operation.replace)
    : original.split(operation.search).join(operation.replace);
  if (next === original) return unchanged(migrationId, operation, "replacement already applied");
  if (!dryRun) writeTextFile(path, next);
  return changed(migrationId, operation, "replace text");
}

function runWriteFile(root: string, migrationId: string, operation: WriteFileOperation, dryRun: boolean): OperationResult {
  const path = resolveInside(root, operation.path);
  const exists = existsSync(path);
  const original = exists ? readFileSync(path, "utf8") : undefined;
  if (original === operation.content) return unchanged(migrationId, operation, "file already matches");
  if (exists && operation.overwrite === false) {
    throw new Error(`${operation.path}: file exists and overwrite=false`);
  }
  if (!dryRun) writeTextFile(path, operation.content);
  return changed(migrationId, operation, exists ? "rewrite file" : "write file");
}

function readJsonDocument(root: string, relPath: string, create: boolean): { path: string; doc: JsonValue } {
  const path = resolveInside(root, relPath);
  if (!existsSync(path)) {
    if (!create) throw new Error(`${relPath}: file does not exist`);
    return { path, doc: {} };
  }
  const parsed = parseJson(readFileSync(path, "utf8"), relPath);
  if (!isJsonValue(parsed)) throw new Error(`${relPath}: file must contain JSON`);
  return { path, doc: parsed };
}

function splitTextLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function writeTextFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function writeJsonFile(path: string, value: JsonValue): void {
  writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveInside(root: string, inputPath: string): string {
  if (!inputPath.trim()) throw new Error("operation path must not be empty");
  if (isAbsolute(inputPath)) throw new Error(`operation path must be relative: ${inputPath}`);
  const absolute = resolve(root, inputPath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new Error(`operation path escapes root: ${inputPath}`);
  }
  return absolute;
}

function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`JSON pointer must start with /: ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getJsonPointer(doc: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = doc;
  for (const part of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
    } else if (isJsonObject(current)) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setJsonPointer(doc: JsonValue, pointer: string, value: JsonValue): JsonValue {
  const parts = parseJsonPointer(pointer);
  if (!parts.length) return value;
  const root = cloneJson(doc);
  if (!isJsonObject(root) && !Array.isArray(root)) {
    throw new Error(`cannot set ${pointer}: document root must be object or array`);
  }
  let current: JsonValue = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const nextPart = parts[i + 1]!;
    const shouldCreateArray = /^\d+$/.test(nextPart);
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0) throw new Error(`invalid array index in pointer: ${pointer}`);
      const next = current[index];
      if (!isJsonObject(next) && !Array.isArray(next)) current[index] = shouldCreateArray ? [] : {};
      current = current[index]!;
    } else if (isJsonObject(current)) {
      const next = current[part];
      if (!isJsonObject(next) && !Array.isArray(next)) current[part] = shouldCreateArray ? [] : {};
      current = current[part]!;
    } else {
      throw new Error(`cannot traverse scalar in pointer: ${pointer}`);
    }
  }
  const leaf = parts.at(-1)!;
  if (Array.isArray(current)) {
    const index = Number(leaf);
    if (!Number.isInteger(index) || index < 0) throw new Error(`invalid array index in pointer: ${pointer}`);
    current[index] = value;
  } else if (isJsonObject(current)) {
    current[leaf] = value;
  } else {
    throw new Error(`cannot set scalar target in pointer: ${pointer}`);
  }
  return root;
}

function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const out: JsonObject = cloneJson(base);
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (isJsonObject(existing) && isJsonObject(value)) out[key] = deepMerge(existing, value);
    else out[key] = cloneJson(value);
  }
  return out;
}

function changed(migrationId: string, operation: MigrationOperation, message: string): OperationResult {
  return {
    migrationId,
    type: operation.type,
    path: operation.path,
    changed: true,
    action: "change",
    message,
  };
}

function unchanged(migrationId: string, operation: MigrationOperation, message: string): OperationResult {
  return {
    migrationId,
    type: operation.type,
    path: operation.path,
    changed: false,
    action: "ok",
    message,
  };
}

function normalizeMigration(input: unknown, label: string): Migration {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  const id = requireString(input.id, `${label}.id`);
  if (!Array.isArray(input.operations)) throw new Error(`${label}.operations must be an array`);
  return {
    id,
    description: input.description === undefined ? undefined : requireString(input.description, `${label}.description`),
    operations: input.operations.map((operation, index) => normalizeOperation(operation, `${label}.operations[${index}]`)),
  };
}

function normalizeOperation(input: unknown, label: string): MigrationOperation {
  if (!isJsonObject(input)) throw new Error(`${label} must be an object`);
  const type = requireString(input.type, `${label}.type`);
  const path = requireString(input.path, `${label}.path`);
  if (type === "ensure-lines") {
    return {
      type,
      path,
      lines: requireStringArray(input.lines, `${label}.lines`),
      after: input.after === undefined ? undefined : requireString(input.after, `${label}.after`),
      before: input.before === undefined ? undefined : requireString(input.before, `${label}.before`),
      create: input.create === undefined ? undefined : requireBoolean(input.create, `${label}.create`),
    };
  }
  if (type === "json-set") {
    if (!isJsonValue(input.value)) throw new Error(`${label}.value must be JSON`);
    return {
      type,
      path,
      pointer: requireString(input.pointer, `${label}.pointer`),
      value: input.value,
      create: input.create === undefined ? undefined : requireBoolean(input.create, `${label}.create`),
    };
  }
  if (type === "json-merge") {
    if (!isJsonObject(input.value)) throw new Error(`${label}.value must be a JSON object`);
    return {
      type,
      path,
      pointer: input.pointer === undefined ? "" : requirePointer(input.pointer, `${label}.pointer`),
      value: input.value,
      create: input.create === undefined ? undefined : requireBoolean(input.create, `${label}.create`),
    };
  }
  if (type === "replace") {
    return {
      type,
      path,
      search: requireString(input.search, `${label}.search`),
      replace: requireString(input.replace, `${label}.replace`),
      all: input.all === undefined ? undefined : requireBoolean(input.all, `${label}.all`),
      required: input.required === undefined ? undefined : requireBoolean(input.required, `${label}.required`),
    };
  }
  if (type === "write-file") {
    return {
      type,
      path,
      content: requireString(input.content, `${label}.content`),
      overwrite: input.overwrite === undefined ? undefined : requireBoolean(input.overwrite, `${label}.overwrite`),
    };
  }
  throw new Error(`${label}.type must be ensure-lines, json-set, json-merge, replace, or write-file`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requirePointer(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value !== "" && !value.startsWith("/")) throw new Error(`${label} must be empty or start with /`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...value];
}

export function relativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

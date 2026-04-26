export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface MigrationConfig {
  version: 1;
  migrations: Migration[];
}

export interface Migration {
  id: string;
  description?: string;
  operations: MigrationOperation[];
}

export type MigrationOperation =
  | EnsureLinesOperation
  | JsonSetOperation
  | JsonMergeOperation
  | ReplaceOperation
  | WriteFileOperation;

export interface BaseOperation {
  type: string;
  path: string;
}

export interface EnsureLinesOperation extends BaseOperation {
  type: "ensure-lines";
  lines: string[];
  after?: string;
  before?: string;
  create?: boolean;
}

export interface JsonSetOperation extends BaseOperation {
  type: "json-set";
  pointer: string;
  value: JsonValue;
  create?: boolean;
}

export interface JsonMergeOperation extends BaseOperation {
  type: "json-merge";
  pointer: string;
  value: JsonObject;
  create?: boolean;
}

export interface ReplaceOperation extends BaseOperation {
  type: "replace";
  search: string;
  replace: string;
  all?: boolean;
  required?: boolean;
}

export interface WriteFileOperation extends BaseOperation {
  type: "write-file";
  content: string;
  overwrite?: boolean;
}

export interface RunMigrationsOptions {
  root?: string;
  dryRun?: boolean;
}

export interface MigrationResult {
  id: string;
  description?: string;
  changed: boolean;
  operations: OperationResult[];
}

export interface OperationResult {
  migrationId: string;
  type: MigrationOperation["type"];
  path: string;
  changed: boolean;
  action: string;
  message: string;
}

export interface MigrationRunResult {
  root: string;
  dryRun: boolean;
  changed: boolean;
  changeCount: number;
  migrations: MigrationResult[];
}

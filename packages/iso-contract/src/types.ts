export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type FieldType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "enum"
  | "date"
  | "datetime"
  | "url"
  | "markdown-link"
  | "score"
  | "json";

export interface ContractField {
  name: string;
  type?: FieldType;
  required?: boolean;
  values?: string[];
  pattern?: string;
  min?: number;
  max?: number;
  default?: JsonValue;
  description?: string;
}

export type ContractFormatStyle = "delimited" | "markdown-table-row";

export interface ContractFormat {
  style?: ContractFormatStyle;
  delimiter?: "tab" | "pipe" | "," | string;
  fields?: string[];
  trim?: boolean;
}

export interface ContractDefinition {
  name: string;
  version?: string;
  description?: string;
  fields: ContractField[];
  formats?: Record<string, ContractFormat>;
}

export interface ContractCatalog {
  contracts: ContractDefinition[];
}

export type ContractInput = ContractCatalog | ContractDefinition | ContractDefinition[];

export interface ContractRecord {
  [key: string]: JsonValue | undefined;
}

export type IssueSeverity = "error" | "warn";

export interface ContractIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  field?: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ContractIssue[];
  record: ContractRecord;
}

export interface ParseResult {
  record: ContractRecord;
  validation: ValidationResult;
}

export interface RenderResult {
  text: string;
  validation: ValidationResult;
}

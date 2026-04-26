import {
  isJsonObject,
  isJsonValue,
} from "./json.js";
import type {
  ContractCatalog,
  ContractDefinition,
  ContractField,
  ContractFormat,
  ContractInput,
  ContractIssue,
  ContractRecord,
  FieldType,
  JsonObject,
  JsonValue,
  ParseResult,
  RenderResult,
  ValidationResult,
} from "./types.js";

export function loadContractCatalog(input: ContractInput): ContractCatalog {
  const contracts = Array.isArray(input)
    ? input
    : isContractCatalog(input)
      ? input.contracts
      : [input as ContractDefinition];

  const seen = new Set<string>();
  for (const contract of contracts) {
    assertContractShape(contract);
    if (seen.has(contract.name)) throw new Error(`duplicate contract "${contract.name}"`);
    seen.add(contract.name);
  }

  return { contracts };
}

export function contractNames(catalog: ContractCatalog): string[] {
  return catalog.contracts.map((contract) => contract.name).sort();
}

export function getContract(catalog: ContractCatalog, name: string): ContractDefinition {
  const contract = catalog.contracts.find((candidate) => candidate.name === name);
  if (!contract) {
    const available = contractNames(catalog).join(", ") || "(none)";
    throw new Error(`unknown contract "${name}" (available: ${available})`);
  }
  return contract;
}

export function validateRecord(contract: ContractDefinition, record: ContractRecord): ValidationResult {
  const issues: ContractIssue[] = [];
  const normalized: ContractRecord = {};
  const fieldNames = new Set(contract.fields.map((field) => field.name));

  for (const field of contract.fields) {
    const raw = record[field.name];
    const value = raw === undefined ? field.default : raw;
    if (isMissing(value)) {
      if (field.required) {
        issues.push(issue("required", `missing required field "${field.name}"`, field.name));
      }
      continue;
    }

    const presentValue = value as JsonValue;
    const coerced = coerceField(field, presentValue);
    if (coerced.ok) {
      normalized[field.name] = coerced.value;
    } else {
      issues.push(issue(coerced.code, coerced.message, field.name));
      normalized[field.name] = jsonFallback(presentValue);
    }
  }

  for (const key of Object.keys(record)) {
    if (!fieldNames.has(key)) {
      issues.push({
        severity: "warn",
        code: "unknown-field",
        field: key,
        message: `unknown field "${key}"`,
      });
      normalized[key] = jsonFallback(record[key]);
    }
  }

  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, errors, warnings, issues, record: normalized };
}

export function parseRecord(contract: ContractDefinition, input: string, formatName: string): ParseResult {
  const format = resolveFormat(contract, formatName);
  const fields = format.fields || contract.fields.map((field) => field.name);
  const cells = splitCells(input, format);
  const record: ContractRecord = {};
  for (let i = 0; i < fields.length; i++) {
    const cell = cells[i];
    if (cell !== undefined) record[fields[i] as string] = cell;
  }
  const validation = validateRecord(contract, record);
  return { record: validation.record, validation };
}

export function renderRecord(contract: ContractDefinition, input: ContractRecord, formatName: string): RenderResult {
  const validation = validateRecord(contract, input);
  if (formatName === "json") {
    return { text: JSON.stringify(validation.record, null, 2), validation };
  }

  const format = resolveFormat(contract, formatName);
  const fields = format.fields || contract.fields.map((field) => field.name);
  const cells = fields.map((name) => cellText(validation.record[name]));

  if ((format.style || "delimited") === "markdown-table-row") {
    return { text: `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`, validation };
  }

  return { text: cells.map(cleanDelimitedCell).join(delimiterFor(format)), validation };
}

export function explainContract(contract: ContractDefinition): string {
  const lines = [
    `${contract.name}${contract.version ? `@${contract.version}` : ""}`,
  ];
  if (contract.description) lines.push(contract.description);
  lines.push("");
  lines.push("fields:");
  for (const field of contract.fields) {
    const bits = [
      field.name,
      field.type || "string",
      field.required ? "required" : "optional",
    ];
    if (field.values?.length) bits.push(`values=${field.values.join("|")}`);
    if (field.pattern) bits.push(`pattern=${field.pattern}`);
    lines.push(`  - ${bits.join(" · ")}`);
  }
  const formats = Object.keys(contract.formats || {});
  if (formats.length) {
    lines.push("");
    lines.push(`formats: ${formats.sort().join(", ")}`);
  }
  return lines.join("\n");
}

function isContractCatalog(value: ContractInput): value is ContractCatalog {
  return isJsonObject(value) && Array.isArray((value as { contracts?: unknown }).contracts);
}

function assertContractShape(contract: ContractDefinition): void {
  if (!isJsonObject(contract)) throw new Error("contract must be a JSON object");
  if (typeof contract.name !== "string" || !contract.name.trim()) {
    throw new Error("contract.name must be a non-empty string");
  }
  if (!Array.isArray(contract.fields) || contract.fields.length === 0) {
    throw new Error(`contract "${contract.name}" must define at least one field`);
  }
  const seen = new Set<string>();
  for (const field of contract.fields) {
    if (!isJsonObject(field) || typeof field.name !== "string" || !field.name.trim()) {
      throw new Error(`contract "${contract.name}" has an invalid field`);
    }
    if (seen.has(field.name)) throw new Error(`contract "${contract.name}" has duplicate field "${field.name}"`);
    seen.add(field.name);
  }
}

function isMissing(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

type CoerceResult =
  | { ok: true; value: JsonValue }
  | { ok: false; code: string; message: string };

function coerceField(field: ContractField, value: JsonValue): CoerceResult {
  const type = field.type || "string";
  const coerced = coerceByType(type, value);
  if (!coerced.ok) return coerced;

  if (field.values?.length && !field.values.includes(String(coerced.value))) {
    return {
      ok: false,
      code: "invalid-enum",
      message: `"${field.name}" must be one of: ${field.values.join(", ")}`,
    };
  }

  if (typeof coerced.value === "number") {
    if (field.min !== undefined && coerced.value < field.min) {
      return { ok: false, code: "below-min", message: `"${field.name}" must be >= ${field.min}` };
    }
    if (field.max !== undefined && coerced.value > field.max) {
      return { ok: false, code: "above-max", message: `"${field.name}" must be <= ${field.max}` };
    }
  }

  if (field.pattern && typeof coerced.value === "string" && !new RegExp(field.pattern).test(coerced.value)) {
    return { ok: false, code: "pattern", message: `"${field.name}" must match /${field.pattern}/` };
  }

  return coerced;
}

function coerceByType(type: FieldType, value: JsonValue): CoerceResult {
  switch (type) {
    case "string":
    case "enum":
      return { ok: true, value: String(value).trim() };
    case "integer": {
      const number = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isInteger(number)) return { ok: false, code: "invalid-integer", message: "value must be an integer" };
      return { ok: true, value: number };
    }
    case "number": {
      const number = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(number)) return { ok: false, code: "invalid-number", message: "value must be a finite number" };
      return { ok: true, value: number };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      const text = String(value).trim().toLowerCase();
      if (text === "true") return { ok: true, value: true };
      if (text === "false") return { ok: true, value: false };
      return { ok: false, code: "invalid-boolean", message: "value must be true or false" };
    }
    case "date": {
      const text = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
        return { ok: false, code: "invalid-date", message: "value must be YYYY-MM-DD" };
      }
      return { ok: true, value: text };
    }
    case "datetime": {
      const text = String(value).trim();
      if (Number.isNaN(Date.parse(text))) return { ok: false, code: "invalid-datetime", message: "value must be an ISO timestamp" };
      return { ok: true, value: new Date(text).toISOString() };
    }
    case "url": {
      const text = String(value).trim();
      if (text.startsWith("local:")) return { ok: true, value: text };
      try {
        const url = new URL(text);
        if (!url.protocol || !url.hostname) throw new Error("missing protocol or host");
      } catch {
        return { ok: false, code: "invalid-url", message: "value must be an absolute URL or local: reference" };
      }
      return { ok: true, value: text };
    }
    case "markdown-link": {
      const text = String(value).trim();
      if (!/^\[[^\]]+\]\([^)]+\)$/.test(text)) {
        return { ok: false, code: "invalid-markdown-link", message: "value must be a markdown link" };
      }
      return { ok: true, value: text };
    }
    case "score": {
      const text = String(value).trim();
      if (text === "N/A" || text === "DUP") return { ok: true, value: text };
      const match = text.match(/^(\d+(?:\.\d+)?)\/5$/);
      if (!match) return { ok: false, code: "invalid-score", message: "value must be X/5, N/A, or DUP" };
      const score = Number(match[1]);
      if (score < 0 || score > 5) return { ok: false, code: "invalid-score", message: "score must be between 0 and 5" };
      return { ok: true, value: text };
    }
    case "json":
      if (!isJsonValue(value)) return { ok: false, code: "invalid-json", message: "value must be JSON-serializable" };
      return { ok: true, value };
  }
}

function resolveFormat(contract: ContractDefinition, name: string): ContractFormat {
  if (name === "json") return { style: "delimited", fields: contract.fields.map((field) => field.name) };
  const format = contract.formats?.[name];
  if (!format) {
    const available = Object.keys(contract.formats || {}).concat("json").sort().join(", ");
    throw new Error(`contract "${contract.name}" has no format "${name}" (available: ${available})`);
  }
  return format;
}

function splitCells(input: string, format: ContractFormat): string[] {
  const text = input.trim();
  if ((format.style || "delimited") === "markdown-table-row") {
    return text.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cleanCell(cell, format));
  }
  return text.split(delimiterFor(format)).map((cell) => cleanCell(cell, format));
}

function delimiterFor(format: ContractFormat): string {
  if (format.delimiter === "tab") return "\t";
  if (format.delimiter === "pipe") return "|";
  return format.delimiter || "\t";
}

function cleanCell(cell: string, format: ContractFormat): string {
  const text = cell.replaceAll("\\|", "|");
  return format.trim === false ? text : text.trim();
}

function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cleanDelimitedCell(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function issue(code: string, message: string, field: string): ContractIssue {
  return { severity: "error", code, field, message };
}

function jsonFallback(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (isJsonValue(value)) return value;
  return String(value);
}

export function recordFromJsonObject(input: JsonObject): ContractRecord {
  const record: ContractRecord = {};
  for (const [key, value] of Object.entries(input)) record[key] = value;
  return record;
}

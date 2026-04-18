import type { Constraint, OutputFormat } from "../schema/plan.js";
import { validateAgainstJSONSchema } from "../schema/validate.js";
import { extractJSON } from "../util/json.js";

export interface CheckResult {
  ok: boolean;
  /** Parsed / coerced value if applicable. */
  value: unknown;
  errors: string[];
}

/**
 * Validate a raw string output against the step's OutputFormat and Constraints.
 * Returns the coerced value (e.g. parsed JSON) on success.
 */
export function checkOutput(
  raw: string,
  format: OutputFormat,
  constraints: Constraint[],
): CheckResult {
  const errors: string[] = [];
  let value: unknown = raw;

  switch (format.kind) {
    case "text": {
      const text = raw.trim();
      value = text;
      if (format.min_chars != null && text.length < format.min_chars) {
        errors.push(`text is ${text.length} chars, min ${format.min_chars}`);
      }
      if (format.max_chars != null && text.length > format.max_chars) {
        errors.push(`text is ${text.length} chars, max ${format.max_chars}`);
      }
      break;
    }
    case "enum": {
      const text = raw.trim();
      value = text;
      if (!format.values.includes(text)) {
        errors.push(`"${text.slice(0, 40)}" not in enum [${format.values.join(", ")}]`);
      }
      break;
    }
    case "json": {
      try {
        const parsed = extractJSON(raw);
        value = parsed;
        const res = validateAgainstJSONSchema(parsed, format.json_schema);
        if (!res.ok) errors.push(...res.errors);
      } catch (err) {
        errors.push(`invalid JSON: ${(err as Error).message}`);
      }
      break;
    }
    case "list": {
      try {
        const parsed = extractJSON(raw);
        if (!Array.isArray(parsed)) {
          errors.push("expected JSON array");
          break;
        }
        value = parsed;
        if (format.min_items != null && parsed.length < format.min_items) {
          errors.push(`list has ${parsed.length} items, min ${format.min_items}`);
        }
        if (format.max_items != null && parsed.length > format.max_items) {
          errors.push(`list has ${parsed.length} items, max ${format.max_items}`);
        }
        parsed.forEach((item, i) => {
          const itemRaw = typeof item === "string" ? item : JSON.stringify(item);
          const sub = checkOutput(itemRaw, format.item_format, []);
          if (!sub.ok) errors.push(`items[${i}]: ${sub.errors.join("; ")}`);
        });
      } catch (err) {
        errors.push(`invalid JSON list: ${(err as Error).message}`);
      }
      break;
    }
  }

  const text = typeof value === "string" ? value : raw;
  for (const c of constraints) {
    if (c.must_match) {
      try {
        if (!new RegExp(c.must_match).test(text)) {
          errors.push(`constraint failed (must_match /${c.must_match}/): "${c.rule}"`);
        }
      } catch {
        errors.push(`invalid regex in must_match: ${c.must_match}`);
      }
    }
    if (c.must_not_match) {
      try {
        if (new RegExp(c.must_not_match).test(text)) {
          errors.push(`constraint failed (must_not_match /${c.must_not_match}/): "${c.rule}"`);
        }
      } catch {
        errors.push(`invalid regex in must_not_match: ${c.must_not_match}`);
      }
    }
  }

  return { ok: errors.length === 0, value, errors };
}

export function formatSpec(format: OutputFormat): string {
  switch (format.kind) {
    case "text": {
      const bits: string[] = [];
      if (format.min_chars != null) bits.push(`min ${format.min_chars} chars`);
      if (format.max_chars != null) bits.push(`max ${format.max_chars} chars`);
      return `plain text${bits.length ? ` (${bits.join(", ")})` : ""}`;
    }
    case "enum":
      return `one of: ${format.values.join(" | ")}`;
    case "json":
      return `JSON matching schema: ${JSON.stringify(format.json_schema)}`;
    case "list": {
      const bits: string[] = [];
      if (format.min_items != null) bits.push(`min ${format.min_items} items`);
      if (format.max_items != null) bits.push(`max ${format.max_items} items`);
      return `JSON array${bits.length ? ` (${bits.join(", ")})` : ""} of ${formatSpec(format.item_format)}`;
    }
  }
}

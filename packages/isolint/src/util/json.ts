/**
 * Extract a JSON value from a model's raw output.
 *
 * Small models often wrap JSON in markdown fences, add preamble text, or
 * trail commentary. We tolerate all of this without being clever enough
 * to silently accept invalid structures.
 */
export function extractJSON(raw: string): unknown {
  const trimmed = raw.trim();

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to brace-scan
  }

  const start = findFirstJSONStart(trimmed);
  if (start === -1) {
    throw new Error("No JSON object or array found in output");
  }
  const end = findMatchingEnd(trimmed, start);
  if (end === -1) {
    throw new Error("Unterminated JSON in output");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function findFirstJSONStart(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{" || c === "[") return i;
  }
  return -1;
}

function findMatchingEnd(s: string, start: number): number {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

import { isJsonObject } from "./json.js";
import type {
  AnyCanonResult,
  CanonCompareResult,
  CanonConfig,
  CanonEntityInput,
  CanonEntityType,
  CanonProfile,
  CanonResult,
  CanonVerdict,
  CompanyRoleCanonResult,
  CompanyRoleInput,
  JsonObject,
  JsonValue,
  MatchOptions,
  TextCanonOptions,
  UrlCanonOptions,
} from "./types.js";

export const DEFAULT_CANON_PROFILE: CanonProfile = {
  name: "default",
  url: {
    dropHash: true,
    stripWww: true,
    lowercaseHost: true,
    keepTrailingSlash: false,
    stripQueryParams: [
      "utm_*",
      "fbclid",
      "gclid",
      "msclkid",
      "gh_src",
      "source",
      "ref",
      "referrer",
    ],
  },
  company: {
    aliases: {},
    suffixes: [
      "inc",
      "incorporated",
      "llc",
      "ltd",
      "limited",
      "corp",
      "corporation",
      "company",
      "co",
      "pbc",
      "plc",
      "lp",
      "llp",
      "gmbh",
      "ag",
      "sa",
      "bv",
    ],
  },
  role: {
    aliases: {
      dev: "developer",
      eng: "engineer",
      fullstack: "full stack",
      jr: "junior",
      mgr: "manager",
      ml: "machine learning",
      sr: "senior",
      swe: "software engineer",
    },
    stopWords: [
      "hybrid",
      "onsite",
      "remote",
      "united states",
      "usa",
      "us",
    ],
  },
  match: {
    strong: 0.92,
    possible: 0.78,
  },
};

export const DEFAULT_CANON_CONFIG: CanonConfig = {
  version: 1,
  profiles: [DEFAULT_CANON_PROFILE],
};

export function loadCanonConfig(value: JsonValue, label = "canon config"): CanonConfig {
  if (!isJsonObject(value)) throw new Error(`${label}: expected object`);
  const version = value.version ?? 1;
  if (version !== 1) throw new Error(`${label}: version must be 1`);
  const profilesValue = value.profiles ?? [];
  if (!Array.isArray(profilesValue)) throw new Error(`${label}: profiles must be an array`);
  const profiles = profilesValue.map((profile, index) => readProfile(profile, `${label}.profiles[${index}]`));
  const names = new Set<string>();
  for (const profile of profiles) {
    if (names.has(profile.name)) throw new Error(`${label}: duplicate profile "${profile.name}"`);
    names.add(profile.name);
  }
  return { version: 1, profiles };
}

export function resolveProfile(config: CanonConfig = DEFAULT_CANON_CONFIG, name?: string): CanonProfile {
  const selected = name
    ? config.profiles.find((profile) => profile.name === name)
    : config.profiles[0];
  if (!selected) {
    if (!name) return DEFAULT_CANON_PROFILE;
    if (name === DEFAULT_CANON_PROFILE.name) return DEFAULT_CANON_PROFILE;
    throw new Error(`canon profile "${name}" was not found`);
  }
  return mergeProfile(DEFAULT_CANON_PROFILE, selected);
}

export function canonicalizeUrl(input: string, profile: CanonProfile = DEFAULT_CANON_PROFILE): CanonResult {
  const resolved = mergeProfile(DEFAULT_CANON_PROFILE, profile);
  const options = resolved.url ?? {};
  const warnings: string[] = [];
  const trimmed = input.trim();
  if (!trimmed) throw new Error("url input is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (withScheme !== trimmed) warnings.push("added https scheme");

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid url "${input}": ${detail}`);
  }

  const protocol = url.protocol.toLowerCase();
  let host = options.lowercaseHost === false ? url.host : url.host.toLowerCase();
  if (options.stripWww !== false && host.startsWith("www.")) host = host.slice(4);
  if (url.username || url.password) warnings.push("dropped url credentials");

  const pathname = normalizePathname(url.pathname, Boolean(options.keepTrailingSlash));
  const search = canonicalSearch(url, options);
  const hash = options.dropHash === false ? url.hash : "";
  const canonical = `${protocol}//${host}${pathname === "/" ? "" : pathname}${search}${hash}`;
  return {
    kind: "url",
    input,
    canonical,
    key: `url:${canonical}`,
    tokens: urlTokens(canonical),
    warnings,
  };
}

export function canonicalizeCompany(input: string, profile: CanonProfile = DEFAULT_CANON_PROFILE): CanonResult {
  return canonicalizeText(input, "company", profile);
}

export function canonicalizeRole(input: string, profile: CanonProfile = DEFAULT_CANON_PROFILE): CanonResult {
  return canonicalizeText(input, "role", profile);
}

export function canonicalizeCompanyRole(
  company: string,
  role: string,
  profile: CanonProfile = DEFAULT_CANON_PROFILE,
): CompanyRoleCanonResult {
  const companyResult = canonicalizeCompany(company, profile);
  const roleResult = canonicalizeRole(role, profile);
  const warnings = [...companyResult.warnings, ...roleResult.warnings];
  return {
    kind: "company-role",
    input: { company, role },
    canonical: `${companyResult.canonical} :: ${roleResult.canonical}`,
    key: `company-role:${companyResult.key.slice("company:".length)}:${roleResult.key.slice("role:".length)}`,
    tokens: [
      ...companyResult.tokens.map((token) => `company:${token}`),
      ...roleResult.tokens.map((token) => `role:${token}`),
    ],
    warnings,
    company: companyResult,
    role: roleResult,
  };
}

export function canonicalizeEntity(
  type: CanonEntityType,
  input: CanonEntityInput,
  profile: CanonProfile = DEFAULT_CANON_PROFILE,
): AnyCanonResult {
  if (type === "url") return canonicalizeUrl(requireStringInput(type, input), profile);
  if (type === "company") return canonicalizeCompany(requireStringInput(type, input), profile);
  if (type === "role") return canonicalizeRole(requireStringInput(type, input), profile);
  const pair = typeof input === "string" ? parseCompanyRoleInput(input) : input;
  return canonicalizeCompanyRole(pair.company, pair.role, profile);
}

export function compareCanon(
  type: CanonEntityType,
  leftInput: CanonEntityInput,
  rightInput: CanonEntityInput,
  profile: CanonProfile = DEFAULT_CANON_PROFILE,
): CanonCompareResult {
  const resolved = mergeProfile(DEFAULT_CANON_PROFILE, profile);
  const left = canonicalizeEntity(type, leftInput, resolved);
  const right = canonicalizeEntity(type, rightInput, resolved);
  const match = resolved.match ?? {};

  if (type === "company-role" && left.kind === "company-role" && right.kind === "company-role") {
    const companyScore = scoreTokens(left.company.tokens, right.company.tokens);
    const roleScore = scoreTokens(left.role.tokens, right.role.tokens);
    const exact = left.key === right.key;
    const score = exact ? 1 : roundScore((companyScore + roleScore) / 2);
    return {
      type,
      verdict: verdictFor(score, match, exact),
      score,
      reasons: exact
        ? ["keys match"]
        : [`company score ${formatScore(companyScore)}`, `role score ${formatScore(roleScore)}`],
      left,
      right,
    };
  }

  const exact = left.key === right.key;
  const score = exact ? 1 : scoreTokens(left.tokens, right.tokens);
  return {
    type,
    verdict: verdictFor(score, match, exact),
    score,
    reasons: exact ? ["keys match"] : [`token score ${formatScore(score)}`],
    left,
    right,
  };
}

export function parseCompanyRoleInput(input: string): CompanyRoleInput {
  const separators = ["::", "\t", "|"];
  for (const separator of separators) {
    const index = input.indexOf(separator);
    if (index !== -1) {
      const company = input.slice(0, index).trim();
      const role = input.slice(index + separator.length).trim();
      if (company && role) return { company, role };
    }
  }
  throw new Error("company-role input must use --company/--role or a 'company :: role' value");
}

function readProfile(value: JsonValue, label: string): CanonProfile {
  if (!isJsonObject(value)) throw new Error(`${label}: expected object`);
  const name = readRequiredString(value, "name", label);
  return {
    name,
    url: readUrlOptions(value.url, `${label}.url`),
    company: readTextOptions(value.company, `${label}.company`),
    role: readTextOptions(value.role, `${label}.role`),
    match: readMatchOptions(value.match, `${label}.match`),
  };
}

function readUrlOptions(value: JsonValue | undefined, label: string): UrlCanonOptions | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new Error(`${label}: expected object`);
  return {
    dropHash: readOptionalBoolean(value, "dropHash", label),
    stripWww: readOptionalBoolean(value, "stripWww", label),
    lowercaseHost: readOptionalBoolean(value, "lowercaseHost", label),
    keepTrailingSlash: readOptionalBoolean(value, "keepTrailingSlash", label),
    stripQueryParams: readOptionalStringArray(value, "stripQueryParams", label),
  };
}

function readTextOptions(value: JsonValue | undefined, label: string): TextCanonOptions | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new Error(`${label}: expected object`);
  return {
    aliases: readOptionalStringMap(value, "aliases", label),
    suffixes: readOptionalStringArray(value, "suffixes", label),
    stopWords: readOptionalStringArray(value, "stopWords", label),
  };
}

function readMatchOptions(value: JsonValue | undefined, label: string): MatchOptions | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new Error(`${label}: expected object`);
  const strong = readOptionalNumber(value, "strong", label);
  const possible = readOptionalNumber(value, "possible", label);
  if (strong !== undefined && (strong <= 0 || strong > 1)) throw new Error(`${label}.strong must be between 0 and 1`);
  if (possible !== undefined && (possible <= 0 || possible > 1)) throw new Error(`${label}.possible must be between 0 and 1`);
  if (strong !== undefined && possible !== undefined && possible > strong) {
    throw new Error(`${label}.possible must be less than or equal to strong`);
  }
  return { strong, possible };
}

function readRequiredString(object: JsonObject, key: string, label: string): string {
  const value = object[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${key} must be a non-empty string`);
  return value;
}

function readOptionalBoolean(object: JsonObject, key: string, label: string): boolean | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label}.${key} must be a boolean`);
  return value;
}

function readOptionalNumber(object: JsonObject, key: string, label: string): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}.${key} must be a number`);
  return value;
}

function readOptionalStringArray(object: JsonObject, key: string, label: string): string[] | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label}.${key} must be a string array`);
  }
  return value.map((item) => String(item));
}

function readOptionalStringMap(object: JsonObject, key: string, label: string): Record<string, string> | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new Error(`${label}.${key} must be an object`);
  const result: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") throw new Error(`${label}.${key}.${entryKey} must be a string`);
    result[entryKey] = entryValue;
  }
  return result;
}

function mergeProfile(base: CanonProfile, override: CanonProfile): CanonProfile {
  return {
    name: override.name || base.name,
    url: mergeUrlOptions(base.url, override.url),
    company: mergeTextOptions(base.company, override.company),
    role: mergeTextOptions(base.role, override.role),
    match: { ...(base.match ?? {}), ...(override.match ?? {}) },
  };
}

function mergeUrlOptions(base: UrlCanonOptions | undefined, override: UrlCanonOptions | undefined): UrlCanonOptions {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    stripQueryParams: mergeStringArrays(base?.stripQueryParams, override?.stripQueryParams),
  };
}

function mergeTextOptions(base: TextCanonOptions | undefined, override: TextCanonOptions | undefined): TextCanonOptions {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    aliases: { ...(base?.aliases ?? {}), ...(override?.aliases ?? {}) },
    suffixes: mergeStringArrays(base?.suffixes, override?.suffixes),
    stopWords: mergeStringArrays(base?.stopWords, override?.stopWords),
  };
}

function mergeStringArrays(base: string[] | undefined, override: string[] | undefined): string[] {
  const result: string[] = [];
  for (const value of [...(base ?? []), ...(override ?? [])]) {
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function canonicalizeText(input: string, kind: "company" | "role", profile: CanonProfile): CanonResult {
  const resolved = mergeProfile(DEFAULT_CANON_PROFILE, profile);
  const options = kind === "company" ? resolved.company ?? {} : resolved.role ?? {};
  const warnings: string[] = [];
  let text = normalizeRawText(input);
  text = applyAliases(text, options.aliases ?? {});
  if (kind === "role") text = removePhrases(text, options.stopWords ?? []);
  let tokens = text ? text.split(" ") : [];
  if (kind === "company") tokens = removeTrailingSuffixes(tokens, options.suffixes ?? []);
  if (kind === "role") tokens = removeStopWordTokens(tokens, options.stopWords ?? []);
  tokens = uniqueOrdered(tokens.filter(Boolean));
  if (!tokens.length) warnings.push("empty input after normalization");
  const slug = tokens.join("-") || "empty";
  return {
    kind,
    input,
    canonical: tokens.join(" "),
    key: `${kind}:${slug}`,
    tokens,
    warnings,
  };
}

function normalizeRawText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[+/]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function applyAliases(text: string, aliases: Record<string, string>): string {
  let result = text;
  const entries = Object.entries(aliases)
    .map(([from, to]) => [normalizeRawText(from), normalizeRawText(to)] as const)
    .filter(([from]) => from)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) result = replacePhrase(result, from, to);
  return result.trim().replace(/\s+/g, " ");
}

function removePhrases(text: string, phrases: string[]): string {
  let result = text;
  const normalized = phrases
    .map((phrase) => normalizeRawText(phrase))
    .filter((phrase) => phrase.includes(" "))
    .sort((a, b) => b.length - a.length);
  for (const phrase of normalized) result = replacePhrase(result, phrase, " ");
  return result.trim().replace(/\s+/g, " ");
}

function replacePhrase(text: string, from: string, to: string): string {
  const pattern = new RegExp(`(^| )${escapeRegExp(from)}(?= |$)`, "g");
  return text.replace(pattern, (_match, prefix: string) => `${prefix}${to}`);
}

function removeTrailingSuffixes(tokens: string[], suffixes: string[]): string[] {
  const suffixSet = new Set(suffixes.flatMap((suffix) => normalizeRawText(suffix).split(" ")).filter(Boolean));
  const result = [...tokens];
  while (result.length && suffixSet.has(result[result.length - 1] ?? "")) result.pop();
  return result;
}

function removeStopWordTokens(tokens: string[], stopWords: string[]): string[] {
  const stopSet = new Set(
    stopWords
      .map((word) => normalizeRawText(word))
      .filter((word) => word && !word.includes(" ")),
  );
  return tokens.filter((token) => !stopSet.has(token));
}

function normalizePathname(pathname: string, keepTrailingSlash: boolean): string {
  const decoded = safeDecodeUri(pathname).replace(/\/{2,}/g, "/");
  if (decoded === "/") return "/";
  return keepTrailingSlash ? decoded : decoded.replace(/\/+$/g, "");
}

function canonicalSearch(url: URL, options: UrlCanonOptions): string {
  const strip = options.stripQueryParams ?? [];
  const kept = Array.from(url.searchParams.entries()).filter(([key]) => !matchesAnyPattern(key, strip));
  if (!kept.length) return "";
  kept.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyCompare = leftKey.localeCompare(rightKey);
    return keyCompare === 0 ? leftValue.localeCompare(rightValue) : keyCompare;
  });
  const encoded = kept.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return `?${encoded.join("&")}`;
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  const lower = value.toLowerCase();
  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (!normalized.includes("*")) return lower === normalized;
    const regex = new RegExp(`^${escapeRegExp(normalized).replace(/\\\*/g, ".*")}$`);
    return regex.test(lower);
  });
}

function urlTokens(canonical: string): string[] {
  return uniqueOrdered(normalizeRawText(canonical).split(" ").filter(Boolean));
}

function scoreTokens(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size && !rightSet.size) return 1;
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  return roundScore((2 * intersection) / (leftSet.size + rightSet.size));
}

function verdictFor(score: number, match: MatchOptions, exact: boolean): CanonVerdict {
  if (exact) return "same";
  const strong = match.strong ?? DEFAULT_CANON_PROFILE.match?.strong ?? 0.92;
  const possible = match.possible ?? DEFAULT_CANON_PROFILE.match?.possible ?? 0.78;
  if (score >= strong) return "same";
  if (score >= possible) return "possible";
  return "different";
}

function requireStringInput(type: CanonEntityType, input: CanonEntityInput): string {
  if (typeof input !== "string") throw new Error(`${type} input must be a string`);
  return input;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatScore(value: number): string {
  return value.toFixed(3).replace(/0+$/g, "").replace(/\.$/g, "");
}

import { createHash } from "node:crypto";
import { isJsonObject, stableStringify, toJsonValue } from "./json.js";
import type {
  AppliedAdjustment,
  CriterionContribution,
  JsonPrimitive,
  PrioritizeAdjustment,
  PrioritizeCheckOptions,
  PrioritizeCheckResult,
  PrioritizeConfig,
  PrioritizeCriterion,
  PrioritizeGate,
  PrioritizeIssue,
  PrioritizeItem,
  PrioritizeMatcher,
  PrioritizeOptions,
  PrioritizeProfile,
  PrioritizeQuota,
  PrioritizeResult,
  PrioritizeStats,
  PrioritizeVerifyResult,
  PrioritizedItem,
  PrioritizedItemState,
} from "./types.js";

const DEFAULT_LIMIT = 10;
const DEFAULT_FAIL_ON: PrioritizedItemState[] = ["blocked"];
const STATE_ORDER: Record<PrioritizedItemState, number> = {
  selected: 0,
  candidate: 1,
  skipped: 2,
  blocked: 3,
};

interface ScoredDraft {
  item: PrioritizeItem;
  state: PrioritizedItemState;
  score: number;
  normalized: number;
  contributions: CriterionContribution[];
  adjustments: AppliedAdjustment[];
  reasons: string[];
}

export function loadPrioritizeConfig(input: unknown): PrioritizeConfig {
  const config = requireObject(input, "config") as unknown as PrioritizeConfig;
  if (config.version !== 1) throw new Error("config.version must be 1");
  if (config.defaults !== undefined) {
    requireObject(config.defaults, "config.defaults");
    if (config.defaults.profile !== undefined && !isNonEmptyString(config.defaults.profile)) {
      throw new Error("config.defaults.profile must be a non-empty string");
    }
    if (config.defaults.limit !== undefined) validatePositiveInteger(config.defaults.limit, "config.defaults.limit");
  }
  if (!Array.isArray(config.profiles) || config.profiles.length === 0) {
    throw new Error("config.profiles must be a non-empty array");
  }

  const profileNames = new Set<string>();
  for (let p = 0; p < config.profiles.length; p++) {
    const profile = requireObject(config.profiles[p], `config.profiles[${p}]`) as unknown as PrioritizeProfile;
    if (!isNonEmptyString(profile.name)) throw new Error(`config.profiles[${p}].name must be a non-empty string`);
    if (profileNames.has(profile.name)) throw new Error(`duplicate profile name "${profile.name}"`);
    profileNames.add(profile.name);
    if (profile.limit !== undefined) validatePositiveInteger(profile.limit, `profile "${profile.name}".limit`);
    validateCriteria(profile);
    validateGates(profile);
    validateAdjustments(profile);
    validateQuotas(profile);
  }
  return config;
}

export function loadPrioritizeItems(input: unknown): PrioritizeItem[] {
  const raw = Array.isArray(input)
    ? input
    : isJsonObject(input) && Array.isArray(input.items)
      ? input.items
      : undefined;
  if (!raw) throw new Error("items must be an array or an object with an items array");

  const seen = new Set<string>();
  const items = raw.map((value, index) => loadPrioritizeItem(value, `items[${index}]`));
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`duplicate item id "${item.id}"`);
    seen.add(item.id);
  }
  items.sort(compareInputItems);
  return items;
}

export function prioritize(configInput: PrioritizeConfig | unknown, itemInput: PrioritizeItem[] | unknown, options: PrioritizeOptions = {}): PrioritizeResult {
  const config = loadPrioritizeConfig(configInput);
  const items = loadPrioritizeItems(itemInput);
  const profile = selectProfile(config, options.profile);
  const limit = options.limit ?? profile.limit ?? config.defaults?.limit ?? DEFAULT_LIMIT;
  validatePositiveInteger(limit, "limit");

  const ranges = criterionRanges(profile.criteria, items);
  const drafts = items.map((item) => scoreItem(profile, item, ranges));
  drafts.sort(compareDrafts);

  applySelection(drafts, profile.quotas || [], limit);

  const prioritizedItems = drafts.map((draft) => prioritizedItem(draft));
  prioritizedItems.sort(comparePrioritizedItems);
  assignRanks(prioritizedItems);
  const result: PrioritizeResult = {
    schemaVersion: 1,
    id: "",
    profile: profile.name,
    limit,
    items: prioritizedItems,
    stats: statsFor(prioritizedItems),
    issues: issuesFor(prioritizedItems, profile.name),
  };
  result.id = prioritizeResultId(result);
  return result;
}

export function selectPrioritized(result: PrioritizeResult): PrioritizeResult {
  const items = result.items.filter((item) => item.state === "selected").map((item) => ({ ...item }));
  assignRanks(items);
  const updated: PrioritizeResult = {
    ...result,
    id: "",
    items,
    stats: statsFor(items),
  };
  updated.id = prioritizeResultId(updated);
  return updated;
}

export function checkPrioritize(config: PrioritizeConfig | unknown, items: PrioritizeItem[] | unknown, options: PrioritizeCheckOptions = {}): PrioritizeCheckResult {
  const result = prioritize(config, items, options);
  const failOn = normalizeFailOn(options.failOn);
  const failStates = new Set(failOn);
  const minSelected = options.minSelected ?? 1;
  if (!Number.isInteger(minSelected) || minSelected < 0) throw new Error("minSelected must be a non-negative integer");
  const issues = [
    ...result.issues,
    ...result.items
      .filter((item) => failStates.has(item.state))
      .map((item) => error("prioritize-fail-state", `${item.id} is ${item.state}`, item.id, result.profile)),
  ];
  if (result.stats.selected < minSelected) {
    issues.push(error("min-selected-not-met", `selected ${result.stats.selected} item(s), expected at least ${minSelected}`, undefined, result.profile));
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  const resultWithIssues: PrioritizeResult = { ...result, id: "", issues };
  resultWithIssues.id = prioritizeResultId(resultWithIssues);
  return {
    ok: errors === 0,
    errors,
    warnings,
    minSelected,
    failOn,
    result: resultWithIssues,
    issues,
  };
}

export function verifyPrioritizeResult(value: unknown): PrioritizeVerifyResult {
  const issues: PrioritizeIssue[] = [];
  if (!isJsonObject(value)) return issueResult(error("invalid-result", "prioritize result must be a JSON object"));
  const result = value as unknown as PrioritizeResult;
  if (result.schemaVersion !== 1) issues.push(error("invalid-schema", "schemaVersion must be 1"));
  if (!isNonEmptyString(result.id)) issues.push(error("invalid-id", "id must be a non-empty string"));
  if (!isNonEmptyString(result.profile)) issues.push(error("invalid-profile", "profile must be a non-empty string"));
  if (!Number.isInteger(result.limit) || result.limit <= 0) issues.push(error("invalid-limit", "limit must be a positive integer"));
  if (!Array.isArray(result.items)) issues.push(error("invalid-items", "items must be an array"));
  if (!isJsonObject(result.stats)) issues.push(error("invalid-stats", "stats must be an object"));
  if (!Array.isArray(result.issues)) issues.push(error("invalid-issues", "issues must be an array"));

  if (Array.isArray(result.items)) {
    for (const [index, item] of result.items.entries()) validateResultItem(item, index, issues);
    if (isJsonObject(result.stats)) {
      const expected = statsFor(result.items);
      for (const key of Object.keys(expected) as Array<keyof PrioritizeStats>) {
        if (result.stats[key] !== expected[key]) issues.push(error("stats-mismatch", `stats.${key} must be ${expected[key]}`));
      }
    }
  }
  if (Array.isArray(result.issues)) {
    for (const [index, issue] of result.issues.entries()) {
      if (issue.severity !== "error" && issue.severity !== "warn") {
        issues.push(error("invalid-issue-severity", `issues[${index}].severity must be error or warn`));
      }
      if (!isNonEmptyString(issue.code)) issues.push(error("invalid-issue-code", `issues[${index}].code must be a non-empty string`));
    }
  }
  if (isNonEmptyString(result.id)) {
    const expected = prioritizeResultId(result);
    if (result.id !== expected) issues.push(error("id-mismatch", `id does not match content hash; expected ${expected}`));
  }
  return issueResult(...issues);
}

export function prioritizeResultId(result: PrioritizeResult | Omit<PrioritizeResult, "id">): string {
  const payload = { ...(result as PrioritizeResult) };
  delete (payload as Partial<PrioritizeResult>).id;
  return `prioritize:${hashJson(toJsonValue(payload)).slice(0, 16)}`;
}

function validateCriteria(profile: PrioritizeProfile): void {
  if (!Array.isArray(profile.criteria) || profile.criteria.length === 0) {
    throw new Error(`profile "${profile.name}" criteria must be a non-empty array`);
  }
  const ids = new Set<string>();
  for (let index = 0; index < profile.criteria.length; index++) {
    const criterion = requireObject(profile.criteria[index], `profile "${profile.name}".criteria[${index}]`) as unknown as PrioritizeCriterion;
    if (!isNonEmptyString(criterion.id)) throw new Error(`profile "${profile.name}".criteria[${index}].id must be a non-empty string`);
    if (ids.has(criterion.id)) throw new Error(`duplicate criterion id "${criterion.id}" in profile "${profile.name}"`);
    ids.add(criterion.id);
    if (!isNonEmptyString(criterion.field)) throw new Error(`criterion "${criterion.id}" field must be a non-empty string`);
    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) throw new Error(`criterion "${criterion.id}" weight must be a positive number`);
    if (criterion.direction !== undefined && criterion.direction !== "desc" && criterion.direction !== "asc") {
      throw new Error(`criterion "${criterion.id}" direction must be desc or asc`);
    }
    if (criterion.min !== undefined && !Number.isFinite(criterion.min)) throw new Error(`criterion "${criterion.id}" min must be numeric`);
    if (criterion.max !== undefined && !Number.isFinite(criterion.max)) throw new Error(`criterion "${criterion.id}" max must be numeric`);
    if (criterion.min !== undefined && criterion.max !== undefined && criterion.min >= criterion.max) {
      throw new Error(`criterion "${criterion.id}" min must be less than max`);
    }
    if (criterion.default !== undefined && !Number.isFinite(criterion.default)) {
      throw new Error(`criterion "${criterion.id}" default must be numeric`);
    }
    if (criterion.required !== undefined && typeof criterion.required !== "boolean") {
      throw new Error(`criterion "${criterion.id}" required must be boolean`);
    }
  }
}

function validateGates(profile: PrioritizeProfile): void {
  const ids = new Set<string>();
  for (const gate of profile.gates || []) {
    requireObject(gate, `profile "${profile.name}".gates[]`);
    if (!isNonEmptyString(gate.id)) throw new Error(`profile "${profile.name}" has a gate with an invalid id`);
    if (ids.has(gate.id)) throw new Error(`duplicate gate id "${gate.id}" in profile "${profile.name}"`);
    ids.add(gate.id);
    if (gate.action !== "skip" && gate.action !== "block") throw new Error(`gate "${gate.id}" action must be skip or block`);
    if (!isNonEmptyString(gate.reason)) throw new Error(`gate "${gate.id}" reason must be a non-empty string`);
    validateMatcher(gate.when, `gate "${gate.id}".when`);
  }
}

function validateAdjustments(profile: PrioritizeProfile): void {
  const ids = new Set<string>();
  for (const adjustment of profile.adjustments || []) {
    requireObject(adjustment, `profile "${profile.name}".adjustments[]`);
    if (!isNonEmptyString(adjustment.id)) throw new Error(`profile "${profile.name}" has an adjustment with an invalid id`);
    if (ids.has(adjustment.id)) throw new Error(`duplicate adjustment id "${adjustment.id}" in profile "${profile.name}"`);
    ids.add(adjustment.id);
    if (!Number.isFinite(adjustment.value)) throw new Error(`adjustment "${adjustment.id}" value must be numeric`);
    if (!isNonEmptyString(adjustment.reason)) throw new Error(`adjustment "${adjustment.id}" reason must be a non-empty string`);
    validateMatcher(adjustment.when, `adjustment "${adjustment.id}".when`);
  }
}

function validateQuotas(profile: PrioritizeProfile): void {
  const ids = new Set<string>();
  for (const quota of profile.quotas || []) {
    requireObject(quota, `profile "${profile.name}".quotas[]`);
    if (!isNonEmptyString(quota.id)) throw new Error(`profile "${profile.name}" has a quota with an invalid id`);
    if (ids.has(quota.id)) throw new Error(`duplicate quota id "${quota.id}" in profile "${profile.name}"`);
    ids.add(quota.id);
    if (!isNonEmptyString(quota.field)) throw new Error(`quota "${quota.id}" field must be a non-empty string`);
    validatePositiveInteger(quota.max, `quota "${quota.id}".max`);
    if (quota.reason !== undefined && !isNonEmptyString(quota.reason)) throw new Error(`quota "${quota.id}" reason must be a non-empty string`);
  }
}

function validateMatcher(matcher: unknown, path: string): void {
  const value = requireObject(matcher, path) as unknown as PrioritizeMatcher;
  if (value.type !== undefined) validateStringOrStringArray(value.type, `${path}.type`);
  if (value.key !== undefined) validateStringOrStringArray(value.key, `${path}.key`);
  if (value.tag !== undefined) validateStringOrStringArray(value.tag, `${path}.tag`);
  if (value.where !== undefined) {
    requireObject(value.where, `${path}.where`);
    for (const [key, item] of Object.entries(value.where)) {
      if (!isNonEmptyString(key)) throw new Error(`${path}.where contains an empty path`);
      if (Array.isArray(item)) {
        if (!item.every(isJsonPrimitive)) throw new Error(`${path}.where.${key} must contain primitive values`);
      } else if (!isJsonPrimitive(item)) {
        throw new Error(`${path}.where.${key} must be primitive or primitive[]`);
      }
    }
  }
}

function loadPrioritizeItem(value: unknown, path: string): PrioritizeItem {
  const item = requireObject(value, path) as unknown as PrioritizeItem;
  if (!isNonEmptyString(item.id)) throw new Error(`${path}.id must be a non-empty string`);
  if (item.key !== undefined && !isNonEmptyString(item.key)) throw new Error(`${path}.key must be a non-empty string`);
  if (item.type !== undefined && !isNonEmptyString(item.type)) throw new Error(`${path}.type must be a non-empty string`);
  if (item.title !== undefined && !isNonEmptyString(item.title)) throw new Error(`${path}.title must be a non-empty string`);
  if (item.tags !== undefined && (!Array.isArray(item.tags) || !item.tags.every(isNonEmptyString))) {
    throw new Error(`${path}.tags must be an array of non-empty strings`);
  }
  if (item.data !== undefined && !isJsonObject(item.data)) throw new Error(`${path}.data must be an object`);
  if (item.source !== undefined) {
    requireObject(item.source, `${path}.source`);
    if (item.source.path !== undefined && typeof item.source.path !== "string") throw new Error(`${path}.source.path must be a string`);
    if (item.source.line !== undefined && (!Number.isInteger(item.source.line) || item.source.line <= 0)) {
      throw new Error(`${path}.source.line must be a positive integer`);
    }
  }
  return item;
}

function selectProfile(config: PrioritizeConfig, name?: string): PrioritizeProfile {
  const profileName = name || config.defaults?.profile || config.profiles[0]?.name;
  const profile = config.profiles.find((candidate) => candidate.name === profileName);
  if (!profile) throw new Error(`profile "${profileName}" not found`);
  return profile;
}

function criterionRanges(criteria: PrioritizeCriterion[], items: PrioritizeItem[]): Map<string, { min: number; max: number }> {
  const ranges = new Map<string, { min: number; max: number }>();
  for (const criterion of criteria) {
    const values = items
      .map((item) => numericValue(getField(item, criterion.field)))
      .filter((value): value is number => value !== null);
    const min = criterion.min ?? (values.length ? Math.min(...values) : 0);
    const max = criterion.max ?? (values.length ? Math.max(...values) : 1);
    ranges.set(criterion.id, min === max ? { min, max: min + 1 } : { min, max });
  }
  return ranges;
}

function scoreItem(profile: PrioritizeProfile, item: PrioritizeItem, ranges: Map<string, { min: number; max: number }>): ScoredDraft {
  const reasons: string[] = [];
  let state: PrioritizedItemState = "candidate";
  for (const gate of profile.gates || []) {
    if (!itemMatches(item, gate.when)) continue;
    state = gate.action === "block" ? "blocked" : "skipped";
    reasons.push(`${gate.action}: ${gate.reason}`);
    break;
  }

  const totalWeight = profile.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const contributions = profile.criteria.map((criterion) => contributionFor(item, criterion, ranges.get(criterion.id) || { min: 0, max: 1 }, reasons));
  const base = totalWeight > 0
    ? contributions.reduce((sum, contribution) => sum + contribution.contribution, 0) / totalWeight * 100
    : 0;
  const adjustments = appliedAdjustments(profile.adjustments || [], item);
  const score = clamp(round(base + adjustments.reduce((sum, adjustment) => sum + adjustment.value, 0), 4), 0, 100);
  if (adjustments.length) reasons.push(...adjustments.map((adjustment) => `${adjustment.value >= 0 ? "boost" : "penalty"}: ${adjustment.reason}`));
  return {
    item,
    state,
    score,
    normalized: round(score / 100, 4),
    contributions,
    adjustments,
    reasons,
  };
}

function contributionFor(
  item: PrioritizeItem,
  criterion: PrioritizeCriterion,
  range: { min: number; max: number },
  reasons: string[],
): CriterionContribution {
  const value = numericValue(getField(item, criterion.field));
  const missing = value === null;
  const requiredMissing = missing && criterion.required === true;
  const raw = missing ? (criterion.default ?? null) : value;
  if (requiredMissing) reasons.push(`missing required criterion: ${criterion.id}`);
  const numeric = raw ?? 0;
  const direction = criterion.direction || "desc";
  const distance = range.max - range.min;
  const normalized = distance <= 0
    ? 0
    : direction === "asc"
      ? clamp((range.max - numeric) / distance, 0, 1)
      : clamp((numeric - range.min) / distance, 0, 1);
  return {
    id: criterion.id,
    label: criterion.label || criterion.id,
    field: criterion.field,
    weight: criterion.weight,
    direction,
    raw,
    normalized: round(normalized, 4),
    contribution: round(normalized * criterion.weight, 4),
    ...(requiredMissing ? { missing: true } : {}),
  };
}

function appliedAdjustments(adjustments: PrioritizeAdjustment[], item: PrioritizeItem): AppliedAdjustment[] {
  return adjustments
    .filter((adjustment) => itemMatches(item, adjustment.when))
    .map((adjustment) => ({ id: adjustment.id, value: adjustment.value, reason: adjustment.reason }));
}

function applySelection(drafts: ScoredDraft[], quotas: PrioritizeQuota[], limit: number): void {
  const quotaCounts = new Map<string, number>();
  let selected = 0;
  for (const draft of drafts) {
    if (draft.state === "blocked" || draft.state === "skipped") continue;
    const quota = firstExceededQuota(draft.item, quotas, quotaCounts);
    if (quota) {
      draft.state = "skipped";
      draft.reasons.push(`quota ${quota.id}: ${quota.reason || `${quota.field} limit ${quota.max} reached`}`);
      continue;
    }
    if (selected < limit) {
      draft.state = "selected";
      selected++;
      incrementQuotas(draft.item, quotas, quotaCounts);
    } else {
      draft.state = "candidate";
      draft.reasons.push(`outside selected limit ${limit}`);
    }
  }
}

function firstExceededQuota(item: PrioritizeItem, quotas: PrioritizeQuota[], counts: Map<string, number>): PrioritizeQuota | undefined {
  for (const quota of quotas) {
    const value = quotaValue(item, quota.field);
    if (value === undefined) continue;
    const key = `${quota.id}\0${value}`;
    if ((counts.get(key) || 0) >= quota.max) return quota;
  }
  return undefined;
}

function incrementQuotas(item: PrioritizeItem, quotas: PrioritizeQuota[], counts: Map<string, number>): void {
  for (const quota of quotas) {
    const value = quotaValue(item, quota.field);
    if (value === undefined) continue;
    const key = `${quota.id}\0${value}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
}

function quotaValue(item: PrioritizeItem, field: string): string | undefined {
  const value = getField(item, field);
  if (value === undefined || value === null || typeof value === "object") return undefined;
  return String(value);
}

function prioritizedItem(draft: ScoredDraft): PrioritizedItem {
  return {
    id: draft.item.id,
    ...(draft.state === "selected" ? { rank: 0 } : {}),
    state: draft.state,
    score: draft.score,
    normalized: draft.normalized,
    ...(draft.item.key ? { key: draft.item.key } : {}),
    ...(draft.item.type ? { type: draft.item.type } : {}),
    ...(draft.item.title ? { title: draft.item.title } : {}),
    item: draft.item,
    contributions: draft.contributions,
    adjustments: draft.adjustments,
    reasons: draft.reasons,
  };
}

function comparePrioritizedItems(a: PrioritizedItem, b: PrioritizedItem): number {
  const state = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (state !== 0) return state;
  const score = b.score - a.score;
  if (score !== 0) return score;
  return compareIdentity(a.item, b.item);
}

function statsFor(items: PrioritizedItem[]): PrioritizeStats {
  const stats: PrioritizeStats = { total: items.length, selected: 0, candidate: 0, skipped: 0, blocked: 0 };
  for (const item of items) stats[item.state]++;
  return stats;
}

function assignRanks(items: PrioritizedItem[]): void {
  let rank = 1;
  for (const item of items) {
    if (item.state === "selected") item.rank = rank++;
    else delete item.rank;
  }
}

function issuesFor(items: PrioritizedItem[], profile: string): PrioritizeIssue[] {
  const issues: PrioritizeIssue[] = [];
  for (const item of items) {
    if (item.state === "blocked") {
      issues.push(error("blocked-item", `${item.id} is blocked`, item.id, profile));
    }
    for (const contribution of item.contributions) {
      if (contribution.missing) {
        issues.push(warn("missing-criterion", `${item.id} missing criterion ${contribution.id}`, item.id, profile));
      }
    }
  }
  return issues;
}

function validateResultItem(value: unknown, index: number, issues: PrioritizeIssue[]): void {
  if (!isJsonObject(value)) {
    issues.push(error("invalid-item", `items[${index}] must be an object`));
    return;
  }
  const item = value as unknown as PrioritizedItem;
  if (!isNonEmptyString(item.id)) issues.push(error("invalid-item-id", `items[${index}].id must be a non-empty string`));
  if (!isPrioritizedState(item.state)) issues.push(error("invalid-item-state", `items[${index}].state is invalid`));
  if (!Number.isFinite(item.score) || item.score < 0 || item.score > 100) issues.push(error("invalid-item-score", `items[${index}].score must be 0-100`));
  if (!Number.isFinite(item.normalized) || item.normalized < 0 || item.normalized > 1) {
    issues.push(error("invalid-item-normalized", `items[${index}].normalized must be 0-1`));
  }
  if (item.state === "selected") {
    const rank = item.rank;
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank <= 0) {
      issues.push(error("invalid-item-rank", `selected items[${index}].rank must be a positive integer`));
    }
  }
  if (!isJsonObject(item.item)) issues.push(error("invalid-original-item", `items[${index}].item must be an object`));
  if (!Array.isArray(item.contributions)) issues.push(error("invalid-contributions", `items[${index}].contributions must be an array`));
  if (!Array.isArray(item.adjustments)) issues.push(error("invalid-adjustments", `items[${index}].adjustments must be an array`));
  if (!Array.isArray(item.reasons)) issues.push(error("invalid-reasons", `items[${index}].reasons must be an array`));
}

function itemMatches(item: PrioritizeItem, matcher: PrioritizeMatcher): boolean {
  if (matcher.type !== undefined && !matchesOne(item.type || "", matcher.type)) return false;
  if (matcher.key !== undefined && !matchesOne(item.key || "", matcher.key)) return false;
  if (matcher.tag !== undefined) {
    const tags = item.tags || [];
    const expected = Array.isArray(matcher.tag) ? matcher.tag : [matcher.tag];
    if (!expected.some((tag) => tags.includes(tag))) return false;
  }
  if (matcher.where !== undefined) {
    for (const [path, expected] of Object.entries(matcher.where)) {
      const actual = getField(item, path);
      if (Array.isArray(expected)) {
        if (!expected.some((value) => primitiveEquals(actual, value))) return false;
      } else if (!primitiveEquals(actual, expected)) {
        return false;
      }
    }
  }
  return true;
}

function getField(item: PrioritizeItem, path: string): unknown {
  const direct = getPath(item as unknown as Record<string, unknown>, path);
  if (direct !== undefined) return direct;
  if (!path.startsWith("data.")) return getPath(item.data as unknown as Record<string, unknown> | undefined, path);
  return undefined;
}

function getPath(value: Record<string, unknown> | undefined, path: string): unknown {
  if (!value) return undefined;
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) && value.trim() !== "" ? number : null;
  }
  return null;
}

function matchesOne(value: string, expected: string | string[]): boolean {
  return Array.isArray(expected) ? expected.includes(value) : value === expected;
}

function primitiveEquals(actual: unknown, expected: JsonPrimitive): boolean {
  if (typeof actual === "number" && typeof expected === "number") return actual === expected;
  return String(actual) === String(expected);
}

function compareDrafts(a: ScoredDraft, b: ScoredDraft): number {
  const score = b.score - a.score;
  if (score !== 0) return score;
  return compareIdentity(a.item, b.item);
}

function compareInputItems(a: PrioritizeItem, b: PrioritizeItem): number {
  return compareIdentity(a, b);
}

function compareIdentity(a: PrioritizeItem, b: PrioritizeItem): number {
  return `${a.key || ""}\0${a.type || ""}\0${a.title || ""}\0${a.id}`.localeCompare(`${b.key || ""}\0${b.type || ""}\0${b.title || ""}\0${b.id}`);
}

function normalizeFailOn(input: PrioritizeCheckOptions["failOn"]): PrioritizedItemState[] {
  if (input === "none") return [];
  if (Array.isArray(input)) return input;
  return DEFAULT_FAIL_ON;
}

function isPrioritizedState(value: unknown): value is PrioritizedItemState {
  return value === "selected" || value === "candidate" || value === "skipped" || value === "blocked";
}

function validateStringOrStringArray(value: unknown, path: string): void {
  if (typeof value === "string" && value.length > 0) return;
  if (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)) return;
  throw new Error(`${path} must be a non-empty string or string[]`);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isJsonObject(value)) throw new Error(`${path} must be an object`);
  return value;
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePositiveInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${path} must be a positive integer`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(toJsonValue(value))).digest("hex");
}

function error(code: string, message: string, item?: string, profile?: string): PrioritizeIssue {
  return { severity: "error", code, message, ...(item ? { item } : {}), ...(profile ? { profile } : {}) };
}

function warn(code: string, message: string, item?: string, profile?: string): PrioritizeIssue {
  return { severity: "warn", code, message, ...(item ? { item } : {}), ...(profile ? { profile } : {}) };
}

function issueResult(...issues: PrioritizeIssue[]): PrioritizeVerifyResult {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return { ok: errors === 0, errors, warnings, issues };
}

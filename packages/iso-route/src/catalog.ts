const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface OpenRouterModel {
  id: string;
  name?: string | null;
  description?: string | null;
  context_length?: number | null;
  supported_parameters?: string[] | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
  } | null;
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
    is_moderated?: boolean | null;
  } | null;
}

export interface OpenRouterCatalogOptions {
  freeOnly?: boolean;
  toolsOnly?: boolean;
  limit?: number;
}

export interface OpenRouterCatalogCandidate {
  id: string;
  name: string;
  score: number;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  pricePrompt: number | null;
  priceCompletion: number | null;
  supportedParameters: string[];
  tags: string[];
}

export interface OpenRouterCatalogSuggestions {
  default: string | null;
  quality: string | null;
  fast: string | null;
  minimal: string | null;
}

export interface OpenRouterCatalogResult {
  provider: "openrouter";
  endpoint: string;
  retrievedAt: string;
  totalModels: number;
  eligibleModels: number;
  filters: {
    freeOnly: boolean;
    toolsOnly: boolean;
    limit: number;
  };
  suggestions: OpenRouterCatalogSuggestions;
  candidates: OpenRouterCatalogCandidate[];
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
  },
) => Promise<FetchLikeResponse>;

export async function fetchOpenRouterModels(
  opts: {
    fetchImpl?: FetchLike;
    endpoint?: string;
  } = {},
): Promise<OpenRouterModel[]> {
  const endpoint = opts.endpoint ?? OPENROUTER_MODELS_URL;
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const res = await fetchImpl(endpoint, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `OpenRouter models request failed: ${res.status} ${res.statusText}`.trim(),
    );
  }
  const body = await res.json();
  if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error("OpenRouter models response missing top-level data[]");
  }
  return (body as { data: OpenRouterModel[] }).data;
}

export function buildOpenRouterCatalog(
  models: OpenRouterModel[],
  opts: OpenRouterCatalogOptions = {},
): OpenRouterCatalogResult {
  const freeOnly = opts.freeOnly ?? true;
  const toolsOnly = opts.toolsOnly ?? true;
  const limit = normaliseLimit(opts.limit);
  const eligible = models.filter((model) => {
    if (freeOnly && !isFree(model)) return false;
    if (toolsOnly && !supports(model, "tools")) return false;
    return true;
  });

  const byGeneral = rank(eligible, scoreGeneral);
  const byQuality = rank(eligible, scoreQuality);
  const byFast = rank(eligible, scoreFast);
  const byMinimal = rank(eligible, scoreMinimal);

  const chosen = new Set<string>();
  const suggestions: OpenRouterCatalogSuggestions = {
    default: pickDistinct(byGeneral, chosen),
    quality: pickDistinct(byQuality, chosen),
    fast: pickDistinct(byFast, chosen),
    minimal: pickDistinct(byMinimal, chosen),
  };

  return {
    provider: "openrouter",
    endpoint: OPENROUTER_MODELS_URL,
    retrievedAt: new Date().toISOString(),
    totalModels: models.length,
    eligibleModels: eligible.length,
    filters: { freeOnly, toolsOnly, limit },
    suggestions,
    candidates: byGeneral.slice(0, limit).map((model) => toCandidate(model)),
  };
}

export function formatOpenRouterCatalog(result: OpenRouterCatalogResult): string {
  const lines = [
    "iso-route: OpenRouter advisory catalog for OpenCode",
    `  source:   ${result.endpoint}`,
    `  filters:  freeOnly=${result.filters.freeOnly} toolsOnly=${result.filters.toolsOnly}`,
    `  models:   ${result.eligibleModels} eligible / ${result.totalModels} total`,
    `  showing:  top ${result.candidates.length}`,
    "",
    "suggested OpenCode role picks:",
    `  default: ${formatSuggestion(result.suggestions.default)}`,
    `  quality: ${formatSuggestion(result.suggestions.quality)}`,
    `  fast:    ${formatSuggestion(result.suggestions.fast)}`,
    `  minimal: ${formatSuggestion(result.suggestions.minimal)}`,
  ];

  if (result.candidates.length) {
    lines.push("", "top candidates:");
    result.candidates.forEach((candidate, index) => {
      const meta = [
        `score ${candidate.score}`,
        candidate.contextLength != null ? `ctx ${candidate.contextLength}` : null,
        candidate.maxCompletionTokens != null ? `out ${candidate.maxCompletionTokens}` : null,
      ]
        .filter(Boolean)
        .join("  ");
      lines.push(`  ${index + 1}. ${candidate.id}`);
      lines.push(`     ${meta}`);
      lines.push(`     tags: ${candidate.tags.join(", ")}`);
    });
  }

  lines.push(
    "",
    `next: \`iso-route init --preset openrouter-free\` for the bundled OpenCode/OpenRouter preset`,
  );
  return lines.join("\n");
}

function defaultFetch(
  input: string,
  init?: { headers?: Record<string, string> },
): Promise<FetchLikeResponse> {
  return fetch(input, init as RequestInit) as Promise<FetchLikeResponse>;
}

function rank(
  models: OpenRouterModel[],
  scoreFn: (model: OpenRouterModel) => number,
): OpenRouterModel[] {
  return [...models].sort((a, b) => {
    const scoreDelta = scoreFn(b) - scoreFn(a);
    if (scoreDelta !== 0) return scoreDelta;
    return a.id.localeCompare(b.id);
  });
}

function pickDistinct(models: OpenRouterModel[], chosen: Set<string>): string | null {
  for (const model of models) {
    if (!chosen.has(model.id)) {
      chosen.add(model.id);
      return model.id;
    }
  }
  return models[0]?.id ?? null;
}

function toCandidate(model: OpenRouterModel): OpenRouterCatalogCandidate {
  return {
    id: model.id,
    name: model.name ?? model.id,
    score: scoreGeneral(model),
    contextLength: contextLengthOf(model),
    maxCompletionTokens: maxCompletionTokensOf(model),
    pricePrompt: priceNumber(model.pricing?.prompt),
    priceCompletion: priceNumber(model.pricing?.completion),
    supportedParameters: supportedParametersOf(model),
    tags: tagsFor(model),
  };
}

function scoreGeneral(model: OpenRouterModel): number {
  let score = 0;
  if (isFree(model)) score += 100;
  if (supports(model, "tools")) score += 220;
  if (supports(model, "tool_choice")) score += 70;
  if (supports(model, "reasoning")) score += 45;
  if (supports(model, "structured_outputs") || supports(model, "response_format")) score += 25;
  score += contextTier(contextLengthOf(model), [
    [262_000, 150],
    [200_000, 130],
    [128_000, 90],
    [64_000, 45],
  ]);
  score += contextTier(maxCompletionTokensOf(model), [
    [131_072, 70],
    [32_768, 35],
    [8_192, 10],
  ]);
  if (isCodeFamily(model)) score += 240;
  if (looksAgentic(model)) score += 30;
  if (isMultimodal(model)) score -= 40;
  if (isPreview(model)) score -= 60;
  if (isAlphaLike(model)) score -= 40;
  if (isMetaRouter(model)) score -= 160;
  return score;
}

function scoreQuality(model: OpenRouterModel): number {
  let score = scoreGeneral(model);
  score += Math.min(extractLargestBillionScale(model.id) ?? 0, 120);
  if (supports(model, "reasoning")) score += 60;
  if (supports(model, "tool_choice")) score += 20;
  if (isCodeFamily(model)) score += 30;
  if (isAlphaLike(model)) score -= 20;
  return score;
}

function scoreFast(model: OpenRouterModel): number {
  let score = scoreGeneral(model);
  if (/minimax/i.test(model.id)) score += 300;
  if (/\bair\b/i.test(model.id)) score += 130;
  if (/gemma/i.test(model.id)) score += 40;
  if (/(?:^|[-/])(nano|mini|small)(?:$|[-/:])/i.test(model.id)) score += 120;
  const size = extractLargestBillionScale(model.id) ?? 0;
  if (size > 0) score -= Math.min(size, 120);
  if (/(120b|405b|480b)/i.test(model.id)) score -= 80;
  return score;
}

function scoreMinimal(model: OpenRouterModel): number {
  let score = 0;
  if (isFree(model)) score += 120;
  if (supports(model, "tools")) score += 180;
  if (supports(model, "tool_choice")) score += 50;
  if (supports(model, "reasoning")) score += 20;
  if (/gemma/i.test(model.id)) score += 170;
  if (/(?:^|[-/])(nano|mini|small)(?:$|[-/:])/i.test(model.id)) score += 130;
  if (/\bair\b/i.test(model.id)) score += 100;
  const size = extractLargestBillionScale(model.id) ?? 0;
  if (size > 0) score += Math.max(0, 70 - Math.round(size));
  if (isMetaRouter(model)) score -= 160;
  if (isPreview(model)) score -= 30;
  if (isAlphaLike(model)) score -= 20;
  return score;
}

function normaliseLimit(limit?: number): number {
  if (limit == null) return 12;
  if (!Number.isFinite(limit) || limit < 1) return 12;
  return Math.floor(limit);
}

function supportedParametersOf(model: OpenRouterModel): string[] {
  if (!Array.isArray(model.supported_parameters)) return [];
  return [...model.supported_parameters].filter((v): v is string => typeof v === "string");
}

function supports(model: OpenRouterModel, param: string): boolean {
  return supportedParametersOf(model).includes(param);
}

function isFree(model: OpenRouterModel): boolean {
  return priceNumber(model.pricing?.prompt) === 0 && priceNumber(model.pricing?.completion) === 0;
}

function priceNumber(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function contextLengthOf(model: OpenRouterModel): number | null {
  if (typeof model.context_length === "number") return model.context_length;
  if (typeof model.top_provider?.context_length === "number") return model.top_provider.context_length;
  return null;
}

function maxCompletionTokensOf(model: OpenRouterModel): number | null {
  if (typeof model.top_provider?.max_completion_tokens === "number") {
    return model.top_provider.max_completion_tokens;
  }
  return null;
}

function contextTier(
  value: number | null,
  tiers: Array<[threshold: number, points: number]>,
): number {
  if (value == null) return 0;
  for (const [threshold, points] of tiers) {
    if (value >= threshold) return points;
  }
  return 0;
}

function extractLargestBillionScale(id: string): number | null {
  const matches = [...id.matchAll(/(\d+(?:\.\d+)?)b/gi)];
  if (!matches.length) return null;
  let largest = 0;
  for (const match of matches) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > largest) largest = n;
  }
  return largest || null;
}

function isCodeFamily(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name ?? ""} ${model.description ?? ""}`;
  return /(coder|codex|coding|code\b)/i.test(haystack);
}

function looksAgentic(model: OpenRouterModel): boolean {
  const haystack = `${model.name ?? ""} ${model.description ?? ""}`;
  return /(agent|multi-agent|tool calling|tool use)/i.test(haystack);
}

function isMultimodal(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name ?? ""} ${model.description ?? ""}`;
  return /(vision|video|audio|\bvl\b|multimodal|lyria)/i.test(haystack);
}

function isPreview(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name ?? ""}`;
  return /preview/i.test(haystack);
}

function isAlphaLike(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name ?? ""}`;
  return /(alpha|beta|experimental)/i.test(haystack);
}

function isMetaRouter(model: OpenRouterModel): boolean {
  return model.id === "openrouter/free" || model.id === "openrouter/auto";
}

function tagsFor(model: OpenRouterModel): string[] {
  const tags = new Set<string>();
  if (isFree(model)) tags.add("free");
  if (supports(model, "tools")) tags.add("tools");
  if (supports(model, "tool_choice")) tags.add("tool_choice");
  if (supports(model, "reasoning")) tags.add("reasoning");
  if (supports(model, "structured_outputs") || supports(model, "response_format")) {
    tags.add("structured");
  }
  if (isCodeFamily(model)) tags.add("code-family");
  if (isMultimodal(model)) tags.add("multimodal");
  if (isPreview(model)) tags.add("preview");
  if (isAlphaLike(model)) tags.add("alpha-like");
  if (isMetaRouter(model)) tags.add("meta-router");
  return [...tags];
}

function formatSuggestion(id: string | null): string {
  if (!id) return "(none)";
  return `provider: openrouter  model: ${id}`;
}

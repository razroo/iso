import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenRouterCatalog,
  fetchOpenRouterModels,
  formatOpenRouterCatalog,
  type OpenRouterModel,
} from "../src/catalog.js";

const FIXTURE: OpenRouterModel[] = [
  {
    id: "qwen/qwen3-coder:free",
    name: "Qwen3 Coder",
    context_length: 262000,
    supported_parameters: ["max_tokens", "tool_choice", "tools", "top_p"],
    pricing: { prompt: "0", completion: "0" },
    top_provider: { max_completion_tokens: 262000 },
  },
  {
    id: "openai/gpt-oss-120b:free",
    name: "GPT OSS 120B",
    context_length: 131072,
    supported_parameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "tool_choice",
      "tools",
    ],
    pricing: { prompt: "0", completion: "0" },
    top_provider: { max_completion_tokens: 131072 },
  },
  {
    id: "minimax/minimax-m2.5:free",
    name: "MiniMax M2.5",
    context_length: 196608,
    supported_parameters: ["max_tokens", "reasoning", "tools"],
    pricing: { prompt: "0", completion: "0" },
    top_provider: { max_completion_tokens: 8192 },
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    name: "Gemma 4 26B A4B",
    context_length: 262144,
    supported_parameters: [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "tool_choice",
      "tools",
    ],
    pricing: { prompt: "0", completion: "0" },
    top_provider: { max_completion_tokens: 32768 },
  },
  {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    context_length: 1_000_000,
    supported_parameters: ["max_tokens", "reasoning", "tool_choice", "tools"],
    pricing: { prompt: "0.000005", completion: "0.000025" },
    top_provider: { max_completion_tokens: 128000 },
  },
  {
    id: "openrouter/free",
    name: "OpenRouter Free Router",
    context_length: 200000,
    supported_parameters: ["tools"],
    pricing: { prompt: "0", completion: "0" },
    top_provider: { max_completion_tokens: null },
  },
];

test("buildOpenRouterCatalog: defaults to a free + tools shortlist for OpenCode", () => {
  const result = buildOpenRouterCatalog(FIXTURE, { limit: 4 });
  assert.equal(result.totalModels, 6);
  assert.equal(result.eligibleModels, 5);
  assert.equal(result.candidates.length, 4);
  assert.equal(result.suggestions.default, "qwen/qwen3-coder:free");
  assert.equal(result.suggestions.quality, "openai/gpt-oss-120b:free");
  assert.equal(result.suggestions.fast, "minimax/minimax-m2.5:free");
  assert.equal(result.suggestions.minimal, "google/gemma-4-26b-a4b-it:free");
  assert.equal(result.candidates[0]?.id, "qwen/qwen3-coder:free");
  assert.ok(
    result.candidates.every((candidate) => candidate.tags.includes("tools")),
    `expected tools tags in ${JSON.stringify(result.candidates)}`,
  );
  assert.ok(
    !result.candidates.some((candidate) => candidate.id === "anthropic/claude-opus-4.7"),
    "paid model should be excluded by default",
  );
});

test("buildOpenRouterCatalog: paid models can be included explicitly", () => {
  const result = buildOpenRouterCatalog(FIXTURE, {
    freeOnly: false,
    toolsOnly: true,
    limit: 8,
  });
  assert.ok(
    result.candidates.some((candidate) => candidate.id === "anthropic/claude-opus-4.7"),
    "paid model should appear when freeOnly=false",
  );
});

test("formatOpenRouterCatalog: renders suggestions and candidate metadata", () => {
  const result = buildOpenRouterCatalog(FIXTURE, { limit: 3 });
  const text = formatOpenRouterCatalog(result);
  assert.match(text, /OpenRouter advisory catalog for OpenCode/);
  assert.match(text, /default: provider: openrouter  model: qwen\/qwen3-coder:free/);
  assert.match(text, /quality: provider: openrouter  model: openai\/gpt-oss-120b:free/);
  assert.match(text, /next: `iso-route init --preset openrouter-free`/);
});

test("fetchOpenRouterModels: validates top-level data[]", async () => {
  const models = await fetchOpenRouterModels({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: FIXTURE }),
    }),
  });
  assert.equal(models.length, FIXTURE.length);

  await assert.rejects(
    fetchOpenRouterModels({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ nope: [] }),
      }),
    }),
    /data\[\]/,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectModelReferences,
  formatVerifyResult,
  verifyPolicyModels,
  type VerifyResult,
  type ModelPolicy,
  type OpenRouterModel,
} from "../src/index.js";

function policy(): ModelPolicy {
  return {
    default: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      targets: {
        opencode: {
          provider: "openrouter",
          model: "qwen/qwen3-coder:free",
          reasoning: "high",
        },
      },
    },
    roles: [
      {
        name: "fast",
        provider: "openrouter",
        model: "z-ai/glm-4.5-air:free",
      },
      {
        name: "reviewer",
        provider: "openai",
        model: "gpt-5",
        fallback: [{ provider: "openrouter", model: "missing/model:free" }],
      },
    ],
    sourcePath: "/tmp/models.yaml",
    sourceDir: "/tmp",
  };
}

const OPENROUTER_FIXTURE: OpenRouterModel[] = [
  {
    id: "qwen/qwen3-coder:free",
    supported_parameters: ["tools", "reasoning"],
  },
  {
    id: "z-ai/glm-4.5-air:free",
    supported_parameters: ["max_tokens"],
  },
];

test("collectModelReferences includes top-level, target override, and fallback refs", () => {
  const refs = collectModelReferences(policy());
  assert.deepEqual(
    refs.map((ref) => ref.where),
    [
      "default",
      "default.targets.opencode",
      "roles.fast",
      "roles.reviewer",
      "roles.reviewer.fallback[0]",
    ],
  );
});

test("verifyPolicyModels validates OpenRouter ids and warns on missing tool/reasoning support", async () => {
  const result = await verifyPolicyModels(policy(), {
    fetchOpenRouterModelsImpl: async () => OPENROUTER_FIXTURE,
  });

  assert.equal(result.passed, false);
  assert.deepEqual(
    result.verified.map((ref) => ref.where),
    ["default.targets.opencode", "roles.fast"],
  );
  assert.deepEqual(
    result.errors.map((issue) => issue.where),
    ["roles.reviewer.fallback[0]"],
  );
  assert.deepEqual(
    result.warnings.map((issue) => issue.where),
    ["roles.fast"],
  );
  assert.deepEqual(
    result.unverifiable.map((ref) => ref.where),
    ["default", "roles.reviewer"],
  );
});

test("formatVerifyResult summarizes unverifiable providers and failures", () => {
  const result: VerifyResult = {
    sourcePath: "/tmp/models.yaml",
    refs: collectModelReferences(policy()),
    verified: [{ where: "roles.fast", provider: "openrouter", model: "z-ai/glm-4.5-air:free" }],
    unverifiable: [{ where: "default", provider: "anthropic", model: "claude-sonnet-4-6" }],
    errors: [
      {
        where: "roles.reviewer.fallback[0]",
        provider: "openrouter",
        model: "missing/model:free",
        message: "not found in the OpenRouter Models API",
        severity: "error",
      },
    ],
    warnings: [],
    passed: false,
  };

  const text = formatVerifyResult(result);
  assert.match(text, /verified:\s+1 via OpenRouter/);
  assert.match(text, /anthropic: 1 reference\(s\)/);
  assert.match(text, /roles\.reviewer\.fallback\[0\]: openrouter\/missing\/model:free not found/);
  assert.match(text, /FAIL/);
});

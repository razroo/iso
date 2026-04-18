import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ModelProvider } from "./types.js";

export interface ProviderSpec {
  /** e.g. "openrouter", "openai", "ollama", "custom" */
  provider?: string;
  /** Model slug, e.g. "anthropic/claude-3.5-sonnet" */
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Build a provider from a simple spec. Resolves sensible defaults from
 * environment variables so users can "just set OPENROUTER_API_KEY".
 */
export function createProvider(spec: ProviderSpec): ModelProvider {
  const provider = (spec.provider ?? inferProvider(spec)).toLowerCase();

  switch (provider) {
    case "openrouter": {
      const apiKey = spec.apiKey ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
      return new OpenAICompatibleProvider({
        apiKey,
        baseUrl: spec.baseUrl ?? "https://openrouter.ai/api/v1",
        model: spec.model,
        label: "openrouter",
        headers: {
          "HTTP-Referer": "https://github.com/razroo/isolint",
          "X-Title": "Isolint",
        },
      });
    }
    case "openai": {
      const apiKey = spec.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      return new OpenAICompatibleProvider({
        apiKey,
        baseUrl: spec.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: spec.model,
        label: "openai",
      });
    }
    case "ollama": {
      return new OpenAICompatibleProvider({
        apiKey: spec.apiKey ?? "ollama",
        baseUrl: spec.baseUrl ?? "http://localhost:11434/v1",
        model: spec.model,
        label: "ollama",
      });
    }
    case "custom": {
      if (!spec.baseUrl) throw new Error("custom provider requires baseUrl");
      return new OpenAICompatibleProvider({
        apiKey: spec.apiKey ?? "none",
        baseUrl: spec.baseUrl,
        model: spec.model,
        label: "custom",
      });
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function inferProvider(spec: ProviderSpec): string {
  if (spec.baseUrl?.includes("openrouter")) return "openrouter";
  if (spec.baseUrl?.includes("ollama") || spec.baseUrl?.includes("11434")) return "ollama";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "openrouter";
}

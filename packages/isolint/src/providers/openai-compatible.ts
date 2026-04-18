import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ModelProvider,
} from "./types.js";

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Optional label prefix for `id`, e.g. "openrouter". */
  label?: string;
  /** Extra headers (e.g. OpenRouter's HTTP-Referer / X-Title). */
  headers?: Record<string, string>;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

/**
 * OpenAI-compatible chat/completions client.
 * Works with OpenAI, OpenRouter, Groq, Together, vLLM, Ollama (OpenAI mode), etc.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly opts: OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts;
    this.id = `${opts.label ?? "openai"}:${opts.model}`;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
    };
    if (req.max_tokens) body.max_tokens = req.max_tokens;
    if (req.stop?.length) body.stop = req.stop;
    if (req.json_mode) body.response_format = { type: "json_object" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 120_000);

    try {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
          ...(this.opts.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${this.id} HTTP ${res.status}: ${text.slice(0, 500)}`);
      }

      const json = (await res.json()) as {
        choices: { message: ChatMessage }[];
        model?: string;
        usage?: CompletionResponse["usage"];
      };

      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`${this.id} returned no content`);
      }

      return {
        content,
        model: json.model ?? this.opts.model,
        usage: json.usage,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Sampling temperature. Defaults are set by the caller. */
  temperature?: number;
  /** Hard cap on output tokens. */
  max_tokens?: number;
  /**
   * If true, provider should coerce output into valid JSON
   * (via response_format or similar). Small models often ignore this;
   * the runtime still validates downstream.
   */
  json_mode?: boolean;
  /** Optional stop sequences. */
  stop?: string[];
}

export interface CompletionResponse {
  content: string;
  /** Provider / model identifier that actually served the request. */
  model: string;
  /** Token usage when reported by provider. */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * A ModelProvider is stateless and provider-agnostic.
 * Planners and runtimes depend only on this interface.
 */
export interface ModelProvider {
  /** Human-readable id for logging, e.g. "openrouter:anthropic/claude-3.5-sonnet". */
  readonly id: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

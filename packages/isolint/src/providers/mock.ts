import type { CompletionRequest, CompletionResponse, ModelProvider } from "./types.js";

/**
 * Deterministic provider used for tests, CI, and `--dry-run`.
 * The handler receives the request and returns the content string.
 */
export class MockProvider implements ModelProvider {
  readonly id: string;
  private readonly handler: (req: CompletionRequest) => string | Promise<string>;

  constructor(label: string, handler: (req: CompletionRequest) => string | Promise<string>) {
    this.id = `mock:${label}`;
    this.handler = handler;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const content = await this.handler(req);
    return { content, model: this.id };
  }
}

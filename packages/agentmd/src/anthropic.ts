import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_TEMPERATURE = 0;

export type AgentFn = (systemPrompt: string, userInput: string) => Promise<string>;
export type JudgeFn = (judgePrompt: string, output: string) => Promise<boolean>;

export interface AgentOptions {
  model?: string;
  temperature?: number;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Export it in your shell or skip `agentmd test` (use `agentmd lint`/`agentmd render` for offline work).",
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

function textFromResponse(
  blocks: Anthropic.Messages.ContentBlock[],
): string {
  return blocks
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function makeAgent(opts: AgentOptions = {}): AgentFn {
  const model = opts.model ?? DEFAULT_AGENT_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  return async (systemPrompt, userInput) => {
    const res = await client().messages.create({
      model,
      temperature,
      system: systemPrompt,
      max_tokens: 1024,
      messages: [{ role: "user", content: userInput }],
    });
    return textFromResponse(res.content);
  };
}

export function makeJudge(opts: AgentOptions = {}): JudgeFn {
  const model = opts.model ?? DEFAULT_JUDGE_MODEL;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  return async (judgePrompt, output) => {
    const system =
      "You are a strict binary judge. Answer only with the single token 'yes' or 'no', lowercase, no punctuation.";
    const user = [
      "The following text is the output of another agent:",
      "---BEGIN OUTPUT---",
      output,
      "---END OUTPUT---",
      "",
      `Question: ${judgePrompt}`,
      "",
      "Answer with exactly 'yes' or 'no'.",
    ].join("\n");
    const res = await client().messages.create({
      model,
      temperature,
      system,
      max_tokens: 4,
      messages: [{ role: "user", content: user }],
    });
    const text = textFromResponse(res.content).trim().toLowerCase();
    return text.startsWith("yes");
  };
}

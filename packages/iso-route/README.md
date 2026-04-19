# @razroo/iso-route

**One model policy, every harness.**

`agentmd`, `isolint`, and `iso-harness` get your *prompts* to every coding
agent. `@razroo/iso-route` does the same thing for your *model choices*:
you declare a default model plus named roles once, and iso-route compiles
that policy into the config file each harness actually reads —
`.claude/settings.json`, `.codex/config.toml`, `opencode.json` — plus a
README note for Cursor (which has no file-based model binding).

Use it to swap Opus for Sonnet everywhere with a single edit, pin a
cheaper model to a `fast-edit` role, or send a `reviewer` role to a
different provider entirely.

> **v0.1 scope:** emits config files for Claude Code, Codex, and OpenCode,
> and a resolved role map (`iso-route.resolved.json`) that `iso-harness`
> consumes when it stamps per-subagent frontmatter. Fallback chains are
> recorded in the resolved map but *not* encoded into any harness config
> — runtime routing lives in proxy layers (OpenRouter, LiteLLM), not
> iso-route.

## Install

```bash
npm install -D @razroo/iso-route
```

## Policy shape

```yaml
# models.yaml
default:
  provider: anthropic
  model: claude-sonnet-4-6

roles:
  planner:
    provider: anthropic
    model: claude-opus-4-7
    reasoning: high

  fast-edit:
    provider: anthropic
    model: claude-haiku-4-5

  reviewer:
    provider: openai
    model: gpt-5
    fallback:
      - { provider: anthropic, model: claude-sonnet-4-6 }
```

Valid providers: `anthropic`, `openai`, `google`, `xai`, `deepseek`,
`mistral`, `groq`, `ollama`, `openrouter`, `local`.
Valid `reasoning` levels: `low`, `medium`, `high`.

## Fan-out mapping

| Field                     | Claude Code                          | Codex                                                | OpenCode                               | Cursor                           |
| ------------------------- | ------------------------------------ | ---------------------------------------------------- | -------------------------------------- | -------------------------------- |
| `default.model`           | `.claude/settings.json` `model`      | `.codex/config.toml` `model`                         | `opencode.json` top-level `model`      | README note only                 |
| `roles.<name>.model`      | resolved map (iso-harness stamps)    | `[profiles.<name>]` in `config.toml`                 | `agent.<name>.model` in `opencode.json`| advisory row in README note      |
| `reasoning`               | closest model tier                   | `model_reasoning_effort`                             | provider-specific                      | advisory                         |
| `fallback[]`              | resolved map only (runtime unsupported) | resolved map only                                 | resolved map only                      | resolved map only                |
| provider auth             | env var convention                   | `[model_providers.<name>]` block                     | `provider` block with `npm` package    | —                                |

Cursor has no programmatic way to bind a model to a rule or chat, so
iso-route emits a README note at `.cursor/iso-route.md` and warns at build
time. Everything else gets a real config file.

## CLI

```bash
iso-route build models.yaml --out .
iso-route build models.yaml --targets claude,codex --dry-run
iso-route plan  models.yaml
```

`build` writes per-harness files under `--out` (defaults to `.`). Add
`--dry-run` to preview without touching disk. `plan` prints the resolved
role table so you can eyeball what each harness will see.

## Library API

```ts
import { build, loadPolicy } from "@razroo/iso-route";

const result = build({ source: "./models.yaml", out: "./.out", dryRun: true });
for (const w of result.warnings) console.warn(w);
```

Individual emitters are exported too (`emitClaude`, `emitCodex`,
`emitOpenCode`, `emitCursor`) if you only need one target.

## How this fits the rest of the pipeline

```
agent.md  →  agentmd lint  →  agentmd render  →  isolint lint  →  iso-harness build
                                                                         +
                                        models.yaml  →  iso-route build  ┘
                                                                         │
                                                                         ▼
                                                          project with CLAUDE.md, settings.json,
                                                          config.toml, opencode.json, …
```

`iso-harness` owns *what the agent reads*. `iso-route` owns *which model
reads it*. They share one output directory and are designed to be run
back-to-back — the `@razroo/iso` wrapper will compose them for you.

## What iso-route is NOT

- **Not a request-level router.** Picking a cheaper model per-request
  based on prompt complexity belongs in a proxy (OpenRouter, LiteLLM,
  Portkey, Not Diamond). iso-route is a build-time transpiler, not an
  inference-path component.
- **Not a model catalog.** It validates provider names, not model IDs.
  If you type a model name your provider doesn't recognize, you'll find
  out at runtime. A catalog package may land in v0.2.

## License

MIT — see [LICENSE](./LICENSE).

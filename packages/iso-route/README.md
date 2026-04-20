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
`mistral`, `groq`, `ollama`, `openrouter`, `opencode`, `local`.
Valid `reasoning` levels: `low`, `medium`, `high`.

### Per-harness overrides

Any role (and the top-level `default`) can declare a `targets.<harness>`
block to pick a different provider + model when iso-route emits for
that harness. Use this to run, for example, Claude on Claude Code,
gpt-5.4 on Codex, and an OpenCode proxy token on OpenCode — all from
one role:

```yaml
roles:
  planner:
    provider: anthropic
    model: claude-opus-4-7
    targets:
      codex:
        provider: openai
        model: gpt-5.4
      opencode:
        provider: opencode
        model: opencode-go/kimi-k2.5
```

When emitting for harness `X`, iso-route uses `targets.X` if present;
otherwise falls through to the generic `provider` + `model`. Emitters
always see a flattened policy so they don't need to know `targets:`
exists.

### Bundled presets (`extends:`)

Two curated presets ship with the package so you don't have to pin
per-harness model picks by hand. Extend one with a single line; override
only what you want to differ.

| preset    | thesis                                                                |
| --------- | --------------------------------------------------------------------- |
| `standard`| Quality-first. Sonnet/Opus on Claude Code, gpt-5.4 on Codex, OpenCode Zen/Go picks per tier. |
| `budget`  | Cost-optimized. Haiku/Sonnet on Claude Code, gpt-5.4-mini/nano on Codex, free-tier and pay-once OpenCode picks. |

Scaffold a starter with the right boilerplate:

```bash
iso-route init                         # writes ./models.yaml extending "standard"
iso-route init --preset budget         # use the budget preset instead
iso-route init --out custom/path.yaml  # different location
iso-route init --force                 # overwrite existing
```

Or write the extension by hand:

```yaml
extends: standard   # or: extends: budget
# ...override only what you want:
roles:
  quality:
    targets:
      codex:
        provider: openai
        model: gpt-5.4
```

User fields win at every key. `roles` merge by name, `targets` merge
per harness (each harness override is atomic — a user's `targets.codex`
replaces the preset's `targets.codex` as a unit, not field-by-field).
Setting an override to `null` removes the preset's value for that
harness.

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
iso-route init                               # scaffold ./models.yaml (extends "standard")
iso-route init --preset budget               # or start from the budget preset
iso-route build models.yaml --out .
iso-route build models.yaml --targets claude,codex --dry-run
iso-route plan  models.yaml
```

`init` scaffolds a starter `models.yaml` that extends a built-in
preset. `build` writes per-harness files under `--out` (defaults to
`.`). Add `--dry-run` to preview without touching disk. `plan` prints
the resolved role table so you can eyeball what each harness will see.

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

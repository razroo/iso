# @razroo/iso-route

## 0.5.2

### Patch Changes

- **Codex:** Stop emitting `[model_providers.openai]` and
  `[model_providers.ollama]`. Recent Codex CLI versions treat those IDs as
  reserved built-ins and refuse to load `config.toml` if they are
  redefined. `model_provider = "openai"` / `"ollama"` still selects the
  built-in providers; use top-level `openai_base_url` or
  `OPENAI_BASE_URL` when only the OpenAI endpoint needs overriding.

## 0.5.1

### Patch Changes

- Retune the `openrouter-free` preset after real-world usage showed
  `qwen/qwen3-coder:free` is the most contended free model on OpenRouter's
  shared pool. Keeps it as the orchestrator default (still the strongest
  free agentic model) but spreads subagent load:

  - `fast`: `minimax/minimax-m2.5:free` → `z-ai/glm-4.5-air:free`
    (more reliable tool-call schema compliance on Geometra flows)
  - `minimal`: `google/gemma-4-26b-a4b-it:free` → `openai/gpt-oss-20b:free`
    (less contended, better structured-output adherence)
  - `quality`: kept on `qwen/qwen3-next-80b-a3b-instruct:free`
    (upgraded from `gpt-oss-120b:free`, matching JobForge's override;
    the preset now ships the actually-best free writing model)

  No breaking changes — existing consumers get better defaults on next
  install.

## 0.5.0

### Minor Changes

- Add the `openrouter-free` preset plus an advisory `iso-route catalog
  openrouter` command.

  `openrouter-free` keeps the `standard` Claude Code / Codex picks but
  switches OpenCode to explicit free OpenRouter model IDs:

  - `default`: `qwen/qwen3-coder:free`
  - `quality`: `openai/gpt-oss-120b:free`
  - `fast`: `minimax/minimax-m2.5:free`
  - `minimal`: `google/gemma-4-26b-a4b-it:free`

  `catalog openrouter` fetches the live OpenRouter `/api/v1/models`
  response, filters to free + tool-capable models by default, ranks a
  shortlist for OpenCode, and prints suggested picks for the default /
  quality / fast / minimal roles. It is advisory only — `build` still
  does not validate model IDs at compile time.

## 0.4.0

### Minor Changes

- Add the `budget` preset — cost-optimized variant of `standard` that
  pushes every tier one step cheaper: `default` drops from sonnet to
  haiku; `quality` drops from opus to sonnet; Codex picks drop from
  gpt-5.4 to gpt-5.4-mini / gpt-5.4-nano; OpenCode uses
  free-tier / pay-once models (`minimax-m2.5-free`, `big-pickle`).
  Scaffold it with `iso-route init --preset budget`.

  `listPresets()` now returns `["standard", "budget"]`. The README
  grew a preset section explaining the `extends:` mechanic (deep
  merge, user-wins, atomic per-harness targets) and how to override
  selectively (e.g. upgrade `budget.quality.targets.claude` back to
  opus with a three-line YAML block).

  README also now documents per-harness overrides via `targets.<harness>`
  (shipped in 0.2.0 but previously undocumented at the package level).

  Two new tests cover the budget preset shape and selective-override
  behavior. Preset content is verified against 2026-04 provider
  catalogs.

## 0.3.1

### Patch Changes

- f49fddd: `standard` preset: add an explicit `default.targets.codex`
  (`openai/gpt-5.4`) so a Codex user running `extends: standard` with
  no further overrides gets a natively-routable OpenAI model instead
  of the Anthropic default flattened as-is. Also tightens the preset
  header comment to cite the specific harness/provider docs used to
  verify each pick (Claude Code model config, Cursor models, Codex
  models, OpenCode models). Content-only — no API or CLI changes.

## 0.3.0

### Minor Changes

- 39c86f8: Bundled preset system — `extends: standard` in models.yaml + `iso-route init`.

  Ships an opinionated cost-tiered preset so newcomers don't have to know
  that OpenCode takes `opencode/*` prefixes, Codex accepts Anthropic
  natively, or which Haiku variant to pin — the decision is made once
  inside iso-route and evolves with new releases.

  **`extends: standard`** in any `models.yaml` pulls in the bundled
  preset as the base layer, then deep-merges the user's fields on top.
  User wins at every key. `targets.<harness>` sub-objects merge atomically
  per harness (a user's override replaces the preset's for that harness
  as a unit, not field-by-field). Explicit `null` on a target removes
  the preset's override.

  ```yaml
  extends: standard
  # Everything below is optional — override only what you want:
  roles:
    quality:
      targets:
        codex:
          provider: openai
          model: gpt-5.4
  ```

  **`iso-route init`** scaffolds a starter `models.yaml` in the current
  directory that extends the standard preset and points the user at the
  overridable hooks:

  ```
  iso-route init                         # writes ./models.yaml
  iso-route init --preset standard       # explicit
  iso-route init --out custom/path.yaml  # different location
  iso-route init --force                 # overwrite existing
  ```

  **Preset content — `standard`** (verified against 2026-04 provider
  catalogs: Anthropic, OpenAI, OpenCode Zen/Go):

  - `default`: anthropic/claude-sonnet-4-6; opencode/glm-5.1 on OpenCode
  - `fast` role: claude-haiku-4-5; opencode/big-pickle on OpenCode;
    openai/gpt-5.4-mini on Codex
  - `quality` role: claude-opus-4-7 with high reasoning; opencode-go/
    kimi-k2.5 on OpenCode; openai/gpt-5.4 with high reasoning on Codex
  - `minimal` role: claude-haiku-4-5; opencode/minimax-m2.5-free on
    OpenCode; openai/gpt-5.4-nano on Codex

  Cursor has no programmatic model binding, so its per-target override
  is absent on every role — `iso-route build` still emits the advisory
  README with the resolved picks for users to select manually from the
  Cursor UI.

  **Additive — fully backwards-compatible.** A `models.yaml` without
  `extends:` behaves exactly as before. The `presets/` directory now
  ships in the published tarball.

  **Deferred follow-up:** an optional cron-scraper that auto-bumps preset
  models when new versions ship upstream. Not in this release — the
  catalog was hand-verified via web search, and preset maintainers will
  bump via a normal release cycle until the scraper lands.

  Adds 10 tests across the parser covering preset loading, scalar
  overrides, atomic target replacement, null-to-remove semantics, unknown
  preset rejection, and adding-new-roles-alongside-preset.

## 0.2.0

### Minor Changes

- 6fc210c: Per-harness model overrides in `models.yaml`.

  A single `models.yaml` can now express different model picks on each
  harness from one source. Add `targets.<harness>` to a role or to the
  top-level default:

  ```yaml
  default:
    provider: anthropic
    model: claude-sonnet-4-6
    targets:
      opencode:
        provider: opencode
        model: opencode/glm-5.1

  roles:
    general-free:
      provider: anthropic
      model: claude-haiku-4-5
      targets:
        opencode:
          provider: opencode
          model: opencode/big-pickle
        codex:
          provider: openai
          model: gpt-5-mini
  ```

  When emitting for harness X, iso-route uses `targets.X` if present;
  otherwise it falls through to the role's or default's generic policy.
  Resolution is flattened before each emit runs, so existing emitters see
  a plain `{ provider, model, reasoning }` on every role — they don't need
  to know `targets:` exists.

  Also adds `opencode` as a valid `provider` for routing to the OpenCode
  proxy (e.g. `opencode/big-pickle`, `opencode-go/minimax-m2.7`). The
  OpenCode emitter special-cases it: no `[model_providers.opencode]`
  block is emitted (there's no SDK package to install — OpenCode handles
  proxy routing natively), and the qualified model is passed through
  verbatim so `provider: opencode` + `model: opencode/big-pickle` emits
  as `opencode/big-pickle` rather than double-prefixing.

  Fully backwards-compatible — omitting `targets:` keeps the existing
  one-policy-everywhere behavior.

## 0.1.0

### Minor Changes

- Initial release. Compile one model policy (`models.yaml` — default
  model plus named roles with optional reasoning effort and fallback
  chain) into each harness's native config: `.claude/settings.json`
  plus a resolved role map for iso-harness to consume; `.codex/config.toml`
  with per-role profiles and `[model_providers.*]` blocks; `opencode.json`
  with provider-qualified models and per-agent overrides; a README
  note at `.cursor/iso-route.md` for Cursor (which has no programmatic
  model binding). Warns loudly when a harness can't express a construct
  (non-Anthropic Claude Code subagents, runtime fallback chains
  anywhere). Runtime-routing concerns (cost-aware per-request model
  selection) remain out of scope — that belongs in proxy layers
  (OpenRouter, LiteLLM, Portkey), not a build-time transpiler.

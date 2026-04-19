---
"@razroo/iso-route": minor
---

Bundled preset system — `extends: standard` in models.yaml + `iso-route init`.

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

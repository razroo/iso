# @razroo/iso-route

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

# @razroo/iso-route

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

# @razroo/iso-harness

## 0.5.0

### Minor Changes

- 9127f0b: Merge — not overwrite — shared config files during the Codex and
  OpenCode emits.

  `@razroo/iso-route` writes model routing config to `.codex/config.toml`
  (`model`, `[profiles.*]`, `[model_providers.*]`) and `opencode.json`
  (`model`, `agent.*`). Previously iso-harness's Codex and OpenCode
  emitters wrote those same files from scratch, stomping everything
  iso-route had put there. The `@razroo/iso` wrapper runs iso-route
  first and iso-harness second, so the net effect was that Codex and
  OpenCode users lost all model routing config on every composed build.

  Codex: the emitter now reads any existing `.codex/config.toml`, strips
  only the `[mcp_servers.*]` sections (iso-harness's domain), preserves
  everything else, and appends the freshly-rendered MCP block.

  OpenCode: the emitter now reads any existing `opencode.json`, preserves
  every field except `$schema` and `mcp`, and layers its own `$schema` +
  `mcp` + user-declared extras on top.

  Behavior when no prior file exists, or when running iso-harness
  standalone without iso-route, is unchanged.

## 0.4.0

### Minor Changes

- Read `<out>/.claude/iso-route.resolved.json` (written by
  `@razroo/iso-route`) during the Claude emit and stamp `model:` onto
  each subagent's frontmatter using `roles[agent.role ?? agent.slug]`.
  Resolution order: `targets.claude.model` → inline `model:` → resolved
  map → nothing. Non-Anthropic roles are skipped with a stderr warning
  (Claude Code subagents only run Anthropic models); missing roles are
  silent. Additive: builds without a resolved map on disk emit
  unchanged. Also loads a new optional `role:` frontmatter field on
  agent source files so a subagent can bind to a role whose name
  differs from its filename slug.

## 0.3.0

### Minor Changes

- Add `iso-harness build --dry-run` and `--watch`, and include dry-run
  summaries with per-file byte sizes.

## 0.2.0

### Minor Changes

- Add `iso-harness validate` subcommand and schema-check the `iso/` source
  before every build. `build` now refuses to write output if `mcp.json`,
  `config.json`, or any agent/command frontmatter has schema errors
  (missing `command`, non-string env vars, duplicate agent names, unknown
  target override keys, etc.). Warnings (empty description, empty body,
  unknown-harness overrides) are surfaced in the build summary but do not
  block the write. Adds `--format json` for machine-readable validator
  output and a proper test suite (18 tests, was 0).

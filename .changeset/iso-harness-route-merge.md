---
"@razroo/iso-harness": minor
---

Merge — not overwrite — shared config files during the Codex and
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

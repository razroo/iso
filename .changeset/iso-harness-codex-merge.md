---
"@razroo/iso-harness": minor
---

Merge — not overwrite — `.codex/config.toml` during the Codex emit.

`@razroo/iso-route` writes model policy, `[profiles.*]`, and
`[model_providers.*]` blocks to `.codex/config.toml`. Previously
iso-harness's Codex emitter wrote the same file from scratch, stomping
on everything iso-route had written. The `@razroo/iso` wrapper runs
iso-route first and iso-harness second, so the net effect was that
Codex users lost all model routing config on every build.

iso-harness now reads any existing `.codex/config.toml`, strips out
only the `[mcp_servers.*]` sections (iso-harness's domain), preserves
everything else, and appends the freshly-rendered MCP block. Behavior
when no prior file exists, or when running iso-harness standalone
without iso-route, is unchanged — a fresh MCP-only config is written.

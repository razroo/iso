# iso-harness

**One config for every coding agent — Cursor, Claude Code, Codex, OpenCode, Pi.**

Keep your instructions, subagents, commands, and MCP servers in a single
`iso/` directory. `iso-harness build` transpiles that source to the
file layout each harness actually reads.

```
iso/                              →  CLAUDE.md                    (Claude Code)
├── instructions.md                  .claude/agents/*.md
├── mcp.json                         .claude/commands/*.md
├── agents/                          .mcp.json
│   └── researcher.md             →  AGENTS.md                    (Codex + OpenCode + Pi)
└── commands/                        .codex/config.toml
    └── review.md                                                         .opencode/agents/*.md
                                     .opencode/skills/*.md
                                     .opencode/opencode-model-fallback.json  (optional; from `opencodeModelFallback` in iso/config.json)
                                     opencode.json
                                  →  .cursor/rules/*.mdc          (Cursor)
                                     .cursor/mcp.json
                                  →  .pi/skills/*/SKILL.md        (Pi)
                                     .pi/prompts/*.md
```

## Quickstart

```bash
npm install
node bin/iso-harness.mjs build --source examples/minimal/iso --out /tmp/iso-demo
```

Or once installed as a CLI:

```bash
iso-harness build                         # reads ./iso, writes to ./
iso-harness build --target claude,cursor  # only two targets
iso-harness build --source path/to/iso --out path/to/project
iso-harness build --dry-run               # print planned writes, no disk changes
iso-harness build --watch                 # rebuild on every change under iso/
```

## Build modes

- `--dry-run` validates and renders the full output plan, but prints what
  would be written instead of touching disk.
- `--watch` keeps a filesystem watcher on the source directory and reruns the
  build after changes. Combine it with `--target` when you only care about one
  harness while iterating.

## Source format

```
iso/
├── instructions.md       # root prompt → CLAUDE.md / AGENTS.md / .cursor/rules/main.mdc
├── config.json           # optional — targets.* merges + opencodeModelFallback file emit
├── mcp.json              # shared MCP server definitions
├── agents/               # subagents
│   └── <slug>.md         # YAML frontmatter + body
└── commands/             # slash commands / skills
    └── <slug>.md         # YAML frontmatter + body
```

### `mcp.json`

A harness-neutral schema. Each server has `command`, optional `args`, optional
`env`. The emitter translates to the shape each harness expects (e.g.
OpenCode wants `type: "local"` and `command` as an array).

```json
{
  "servers": {
    "example": {
      "command": "npx",
      "args": ["-y", "@example/mcp"],
      "env": { "EXAMPLE_MODE": "demo" }
    }
  }
}
```

By design, `mcp.json` has **no per-harness override mechanism**. The
same MCP server should behave the same way no matter which harness
launches it — if it doesn't, that's an MCP/config issue to fix at the
server level, not something the shared config should paper over.

### Agent frontmatter

```yaml
---
name: researcher
description: Researches technical topics.
model: sonnet
tools: [Read, Grep, WebFetch]
targets:
  cursor: skip                  # don't emit for Cursor
  codex: skip
  opencode:                     # per-target overrides pass through verbatim
    temperature: 0.2
    fallback_models: [foo, bar]
---

Agent prompt body goes here.
```

### Command frontmatter

```yaml
---
name: review
description: Review the current git diff.
args: "[scope]"                 # argument hint
targets:
  cursor: skip
---

Slash-command body goes here.
```

## Targets

| Harness      | Instructions                     | Agents                      | Commands                    | MCP                        |
|--------------|----------------------------------|-----------------------------|-----------------------------|----------------------------|
| Claude Code  | `CLAUDE.md`                      | `.claude/agents/*.md`       | `.claude/commands/*.md`     | `.mcp.json`                |
| Cursor       | `.cursor/rules/main.mdc`         | `.cursor/rules/agent-*.mdc` | _(no native form)_          | `.cursor/mcp.json`         |
| Codex        | `AGENTS.md`                      | _(no native form)_          | _(no native form)_          | `.codex/config.toml`       |
| OpenCode     | `AGENTS.md`                      | `.opencode/agents/*.md`     | `.opencode/skills/*.md`     | `opencode.json`            |
| Pi           | `AGENTS.md`                      | `.pi/skills/*/SKILL.md`     | `.pi/prompts/*.md`          | _(extension/package only)_  |

## Escape hatches

The abstraction is only as good as its lowest common denominator. Four
explicit hatches keep harness-specific features possible:

1. **Per-target frontmatter under `targets:`** (agents & commands).
   Harness-specific fields under `targets.<name>` are mapped or passed
   through where that target supports them. Use this for OpenCode
   `temperature` / `fallback_models`, Claude Code `allowed-tools`, Pi
   skill metadata, etc.
2. **`targets.<name>: skip`** omits the item from a specific target —
   useful when a subagent only makes sense in harnesses that support
   subagents.
3. **`iso/config.json` with `targets.<name>: { … }`** for top-level
   harness config (not per-item). Keys under `targets.opencode` are
   merged into the generated `opencode.json` — use this for OpenCode's
   top-level `instructions: [...]` array, for example. Keys under
   `targets.pi` are merged into `.pi/settings.json`.
4. **`iso/config.json` top-level `opencodeModelFallback`** — JSON object
   written verbatim to `.opencode/opencode-model-fallback.json` for the
   [`@razroo/opencode-model-fallback`](https://www.npmjs.com/package/@razroo/opencode-model-fallback)
   plugin (`retryable_error_patterns`, global `fallback_models`, etc.).
   OpenCode-only; other harnesses ignore it.

```json
// iso/config.json
{
  "targets": {
    "opencode": {
      "instructions": ["templates/states.yml"]
    },
    "pi": {
      "prompts": ["prompts"],
      "enableSkillCommands": true
    }
  },
  "opencodeModelFallback": {
    "cooldown_seconds": 60,
    "retryable_error_patterns": ["(?i)venice.*insufficient"],
    "fallback_models": ["openrouter/openai/gpt-oss-120b:free"]
  }
}
```

Per-agent OpenCode `fallback_models` still belong in agent frontmatter
under `targets.opencode`. Use `opencodeModelFallback` only for the
**global** plugin file OpenCode loads from `.opencode/`.

## Composition with `@razroo/iso-route`

When [`@razroo/iso-route`](https://www.npmjs.com/package/@razroo/iso-route)
writes its resolved role map to `<out>/.claude/iso-route.resolved.json`
(normally by running `iso-route build` into the same output directory
before `iso-harness build`), iso-harness picks it up automatically and
stamps `model:` onto each Claude subagent frontmatter.

Resolution order per subagent, highest to lowest:

1. Per-target `targets.claude.model` from the agent's frontmatter.
2. Inline `model:` from the agent's frontmatter.
3. `roles[agent.role ?? agent.slug].model` from the resolved map.
4. Nothing — the emitted frontmatter has no `model:` field.

So an author can (a) hard-pin a model in the source file, (b) let
iso-route drive it from policy, or (c) leave it to Claude Code's
session default — without editing the agent body.

Non-Anthropic roles in the resolved map are skipped (Claude Code
subagents can only run Anthropic models) and logged on stderr. Missing
roles are silent — not every agent needs a role entry.

For Pi, `iso-route` owns `.pi/settings.json` model defaults. If
`iso/config.json` also contains `targets.pi`, iso-harness merges those
project settings into the existing file instead of replacing model
settings.

The contract is file-based on purpose: iso-harness and iso-route
publish and version independently, so an on-disk JSON file is more
robust than a TypeScript import across the two.

## Releasing

Releases are cut via a GitHub Release, which triggers
`.github/workflows/release.yml` to publish `@razroo/iso-harness` to npm
with provenance.

Prerequisites (one-time):

1. Repo secret **`NPM_TOKEN`** — an npm automation token with publish
   rights on the `@razroo` scope. Set at
   `https://github.com/razroo/iso-harness/settings/secrets/actions`.
2. Npm scope `@razroo` must exist and the token must have access.

Cutting a release:

```bash
# 1. Bump version, commit, push. CI (Quality checks) must pass on the
#    pushed commit — the release workflow refuses to publish otherwise.
npm version patch                     # or minor/major — bumps package.json + tags
git push && git push --tags

# 2. Create the GitHub Release off the tag. This fires release.yml.
gh release create "v$(node -p 'require(\"./package.json\").version')" \
  --generate-notes
```

The release workflow will:

1. Wait for the **Quality checks** run on the release commit to complete
   (up to 30 min). Refuses to publish on red.
2. Verify `package.json` version matches the tag via
   `scripts/release/check-source.mjs`.
3. `npm publish --provenance --access public`.

If the publish step fails (e.g. token, 2FA, name conflict), fix the
cause, delete the GitHub release + tag, and re-cut — do not amend.

## Status

v0.1 — instructions, agents, commands, MCP. Hooks, permissions, and
per-harness-only features are out of scope for v1.

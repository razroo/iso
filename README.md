<p align="center">
  <img src="./assets/logo.svg" alt="iso" width="320">
</p>

# iso

**Write your AI agent instructions once. Run them anywhere, on any model.**

`iso` is Razroo's toolchain for making agent harnesses *isomorphic* — the
same authored source produces the same agent behavior across every coding
harness (Cursor, Claude Code, Codex, OpenCode) and across every model tier
(frontier models down to 7B local models).

Today, writing agent instructions is fragmented on two axes:

1. **Harness fragmentation.** Each coding agent reads a different file
   layout — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`,
   `.opencode/agents/*.md`, `.mcp.json` vs `opencode.json` vs
   `.codex/config.toml`. Keeping them in sync is copy-paste drift.
2. **Model fragmentation.** A prompt written with a frontier model in mind
   quietly breaks on smaller models: soft imperatives (`should`,
   `when relevant`), taste words, ambiguous cross-references, and
   unstructured rationale all drop silently at 7B. You don't find out
   until the agent misbehaves in production.

Three core packages in this repo compose into a pipeline that fixes both,
and a fourth wrapper package exposes that whole chain behind one CLI:

```
   authored source              structural dialect             portable prose             fan-out to harnesses
  ┌────────────────┐  agentmd  ┌──────────────────┐  isolint  ┌───────────────┐  iso-harness  ┌──────────────────┐
  │ your agent .md │ ────────▶ │ validated rules, │ ────────▶ │ small-model-  │ ─────────────▶│ CLAUDE.md        │
  │ + fixtures     │   lint    │ scope labels,    │ lint/fix  │ safe prose    │    build      │ AGENTS.md        │
  │                │  render   │ load-bearing why │           │               │               │ .cursor/rules/*  │
  └────────────────┘           └──────────────────┘           └───────────────┘               │ .opencode/*      │
                                                                                              └──────────────────┘
```

## Packages

- **[`packages/agentmd`](./packages/agentmd)** — [`@razroo/agentmd`](https://www.npmjs.com/package/@razroo/agentmd)
  A structured-markdown dialect for agent prompts. Rules are scoped
  (`[H1]` hard limit, `[D1]` default) with load-bearing `why:` rationale.
  Ships a linter for structure (missing rationale, dangling refs, no
  fallback row) and a fixture-driven harness that measures per-rule
  adherence against the target model.

- **[`packages/isolint`](./packages/isolint)** — [`@razroo/isolint`](https://www.npmjs.com/package/@razroo/isolint)
  Lints the compiled prose for phrases weak small models can't parse —
  `should`, `when relevant`, `one of the usual categories`, taste words,
  long sentences, unclosed `etc.` lists. `--fix --llm` rewrites offenders
  and re-lints the rewrite before accepting. Also ships an Isomorphic
  Plan engine for fully-deterministic large-model-plans → small-model-run
  pipelines.

- **[`packages/iso-harness`](./packages/iso-harness)** — [`@razroo/iso-harness`](https://www.npmjs.com/package/@razroo/iso-harness)
  One `iso/` source directory → the file layout each coding agent
  actually reads. Transpiles instructions, subagents, slash commands, and
  MCP servers into `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`,
  `.opencode/agents/*.md`, etc., so all four harnesses stay in lockstep.

- **[`packages/iso`](./packages/iso)** — `@razroo/iso`
  The wrapper CLI for the whole flow: if `agent.md` is your authored source,
  `iso build` runs `agentmd lint`, `agentmd render`, `isolint lint`, then
  `iso-harness build` in one command.

Each package is independently published on npm and works on its own.
They're in one repo because they're designed to compose.

## Layout

```
iso/
├── package.json          # workspaces root
├── tsconfig.base.json    # shared compiler options
└── packages/
    ├── agentmd/          # structure + adherence
    ├── isolint/          # portable prose
    ├── iso-harness/      # one source, every harness
    └── iso/              # one command for the whole pipeline
```

## Build & test

```bash
npm install                 # install all workspace deps
npm run build               # build every package
npm run test                # run every package's tests
npm run typecheck           # typecheck every package
npm run test:dogfood        # wrapper-level local dogfood project
npm run test:pipeline       # end-to-end demo (agentmd → isolint → iso-harness)

# Target a single package
npm run build --workspace @razroo/isolint
npm run test  --workspace @razroo/agentmd
npm run test  --workspace @razroo/iso
```

## Releasing

Version bumps are driven by [Changesets](https://github.com/changesets/changesets).
Every PR that changes a package should include a changeset describing the
user-visible impact:

```bash
npm run changeset          # interactive — pick packages + bump level + summary
npm run changeset:status   # preview what the next `version` would do
```

When you're ready to cut a release:

```bash
npm run version            # bumps package versions + writes CHANGELOG.md
git commit -am "Version packages"
git tag <pkg>-v<version>   # e.g. agentmd-v0.3.0
git push && git push --tags
gh release create <pkg>-v<version> --generate-notes
```

The tag-triggered release workflows in `.github/workflows/*-release.yml`
take over from there — verify the tag matches `package.json`, run tests,
build, and `npm publish --provenance`.

## End-to-end example

[`examples/pipeline/`](./examples/pipeline) is an executable demonstration
of the composed pipeline: one authored `agent.md` is structurally linted,
rendered, prose-linted, and fanned out into the 11 files each coding-agent
harness expects. Run `npm run test:pipeline` to exercise the core pipeline,
or use `@razroo/iso` in your own project when you want the same chain behind
one CLI.

[`examples/dogfood/`](./examples/dogfood) is a local dogfood project for the
wrapper CLI itself. It starts from `agent.md` + `iso/` source and runs the
repo's local `packages/iso/bin/iso.mjs` entrypoint to produce the full harness
fan-out. Run `npm run test:dogfood` to exercise the same wrapper path a
downstream repo would use.

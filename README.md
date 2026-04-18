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

Three core packages compose into a build pipeline that fixes both,
[`@razroo/iso`](./packages/iso) runs the whole chain as one command, and
[`@razroo/iso-eval`](./packages/iso-eval) scores whether the resulting
agent actually completes real tasks:

```
   authored source              structural dialect             portable prose             fan-out to harnesses           behavioral eval
  ┌────────────────┐  agentmd  ┌──────────────────┐  isolint  ┌───────────────┐  iso-harness  ┌──────────────────┐   iso-eval  ┌──────────────┐
  │ your agent .md │ ────────▶ │ validated rules, │ ────────▶ │ small-model-  │ ─────────────▶│ CLAUDE.md        │ ──────────▶ │ per-task     │
  │ + fixtures     │   lint    │ scope labels,    │ lint/fix  │ safe prose    │    build      │ AGENTS.md        │    run      │ pass / fail  │
  │                │  render   │ load-bearing why │           │               │               │ .cursor/rules/*  │             │              │
  └────────────────┘           └──────────────────┘           └───────────────┘               │ .opencode/*      │             └──────────────┘
                                                                                              └──────────────────┘
```

## Quickstart

Most users want `@razroo/iso` — one install, one command, every harness:

```bash
npm install -D @razroo/iso
npx iso build .
```

Given an `agent.md` (or an existing `iso/instructions.md`) and an `iso/`
source directory, this lints the authored source, rewrites it for
small-model safety, and fans it out into `CLAUDE.md`, `AGENTS.md`,
`.cursor/rules/*`, `.opencode/*`, and the matching MCP config files.

See [`packages/iso`](./packages/iso) for the full CLI reference and
library API, or [`examples/dogfood/`](./examples/dogfood) for a runnable
project that exercises the wrapper end-to-end.

## Packages

- **[`packages/iso`](./packages/iso)** — [`@razroo/iso`](https://www.npmjs.com/package/@razroo/iso) · *recommended entry point*
  The wrapper CLI for the whole flow. If `agent.md` is your authored
  source, `iso build` runs `agentmd lint`, `agentmd render`, `isolint
  lint`, then `iso-harness build` in one command. Use this unless you
  have a reason to reach for a sub-package directly.

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

- **[`packages/iso-eval`](./packages/iso-eval)** — [`@razroo/iso-eval`](https://www.npmjs.com/package/@razroo/iso-eval)
  Behavioral eval runner for the produced harness. Snapshots a workspace
  per task, hands it to a runner with the task prompt, then scores the
  resulting filesystem / command state — answering "did the agent
  actually do it?" that structural and prose lints can't. Ships a
  deterministic `fake` runner for CI smoke; real-agent runners plug in
  via the library `RunnerFn` interface.

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
    ├── iso/              # one command for the whole pipeline
    └── iso-eval/         # behavioral eval on the produced harness
```

## Build & test

```bash
npm install                 # install all workspace deps
npm run build               # build every package
npm run test                # run every package's tests
npm run typecheck           # typecheck every package
npm run test:dogfood        # wrapper-level local dogfood project
npm run test:pack           # pack local tarballs and smoke installed CLIs
npm run test:pipeline       # end-to-end demo (agentmd → isolint → iso-harness)
npm --workspace @razroo/iso-eval run example   # iso-eval against the bundled example suite

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

`npm run test:pack` goes one level further: it packs the local workspaces into
tarballs, installs them into fresh temp projects, and smoke-tests the packaged
`iso-harness`, `iso`, and `iso-eval` CLIs. This guards against packaging
regressions that workspace-only tests can miss.

[`packages/iso-eval/examples/suites/echo-basic/`](./packages/iso-eval/examples/suites/echo-basic)
is a runnable eval suite for the downstream side: a baseline workspace, a
task prompt, and a set of file/command checks. Run `npm --workspace
@razroo/iso-eval run example` to see the full pass-report against the
bundled `fake` runner.

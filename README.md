<p align="center">
  <img src="./assets/logo.svg" alt="iso" width="320">
</p>

# iso

**Write your AI agent instructions once. Run them anywhere, on any model.**

`iso` is Razroo's toolchain for making agent harnesses *isomorphic* — one
authored source fans out to every coding harness (Cursor, Claude Code,
Codex, OpenCode) and stays legible across model tiers (frontier models down
to 7B local models). The repo now covers the full loop: build portable
harness files, route models, replay evals, parse production traces, scope
role capabilities, audit runtime policy, validate artifact contracts, and
persist local workflow truth. The only narrower surface is `iso-trace model-score`, which still
depends on transcripts exposing stable model metadata.

Today, agent workflow reliability is fragmented on three axes:

1. **Harness fragmentation.** Each coding agent reads a different file
   layout — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`,
   `.opencode/agents/*.md`, `.mcp.json` vs `opencode.json` vs
   `.codex/config.toml`. Keeping them in sync is copy-paste drift.
2. **Model fragmentation.** A prompt written with a frontier model in mind
   quietly breaks on smaller models: soft imperatives (`should`,
   `when relevant`), taste words, ambiguous cross-references, and
   unstructured rationale all drop silently at 7B. You don't find out
   until the agent misbehaves in production.
3. **Runtime fragmentation.** Workflows rely on fragile prompt prose for
   fan-out limits, role permissions, output shape, duplicate checks, and
   "what already happened." Those invariants belong in deterministic local packages,
   not in repeatedly re-tokenized instructions.

Twelve packages solve that in one pipeline with runtime control and a
feedback loop:

- **Four build-time tools** turn your authored source into every harness's file layout:
  [`@razroo/agentmd`](./packages/agentmd) validates *structure*,
  [`@razroo/isolint`](./packages/isolint) rewrites *prose* for small-model safety,
  [`@razroo/iso-harness`](./packages/iso-harness) *fans out* to every harness, and
  [`@razroo/iso-route`](./packages/iso-route) compiles *one model policy* into each harness's config.
- **One wrapper** runs the whole build chain:
  [`@razroo/iso`](./packages/iso) chains the above into a single `iso build`.
- **Four runtime-control libraries** handle durable execution, role capabilities, artifact shape, and operational truth:
  [`@razroo/iso-orchestrator`](./packages/iso-orchestrator) provides resumable
  steps, keyed mutexes, and bounded fan-out for side-effectful agent workflows,
  [`@razroo/iso-capabilities`](./packages/iso-capabilities) resolves,
  checks, and renders role-level tool/MCP/command/filesystem/network policy,
  [`@razroo/iso-contract`](./packages/iso-contract) validates, parses, and
  renders structured workflow artifacts, and [`@razroo/iso-ledger`](./packages/iso-ledger)
  records append-only domain events with idempotency keys, queries,
  verification, and materialized views.
- **Three feedback tools** close the loop after deploy:
  [`@razroo/iso-eval`](./packages/iso-eval) scores *did the agent complete the task?* and
  [`@razroo/iso-trace`](./packages/iso-trace) parses production transcripts to show *what the agent actually did*,
  while [`@razroo/iso-guard`](./packages/iso-guard) enforces operational policies against those event streams.

```
                authoring                          build                               output                        feedback
  ┌────────────────────┐  agentmd  ┌───────────────────┐  isolint  ┌─────────────────┐  iso-harness  ┌───────────────────────┐    iso-eval  ──▶  per-task pass / fail
  │ agent.md           │ ────────▶ │ validated rules,  │ ────────▶ │ small-model-    │ ────────────▶ │ CLAUDE.md             │                    (behavioral scoring)
  │ + fixtures         │   lint    │ scope labels,     │ lint/fix  │ safe prose      │    build      │ AGENTS.md             │
  │                    │   render  │ load-bearing why  │           │                 │               │ .cursor/rules/*       │    iso-trace ──▶  production events,
  └────────────────────┘           └───────────────────┘           └─────────────────┘               │ .opencode/agents/*    │                    which rules ever fired,
                                                                                                     │ settings.json         │                    regression-fixture mining
                                                                                                     │                      │    iso-guard ─▶  policy pass / fail
                                                                                                     │                      │    iso-capabilities ─▶ role permission policy
  ┌────────────────────┐                                                                             │ .codex/config.toml    │
  │ models.yaml        │ ───────────────────── iso-route build ─────────────────────────────────────▶│ opencode.json         │
  │ (roles + fallback) │                                                                             │ .mcp.json             │
  └────────────────────┘                                                                             └───────────────────────┘

                    @razroo/iso chains agentmd → isolint → iso-route (when models.yaml exists) → iso-harness in one command.
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

## Shipped Support Matrix

Build, replay, and transcript parsing now ship across all four harnesses.
The remaining narrower surface is `iso-trace model-score`, which is only
available where the source transcript exposes stable model metadata.

| Harness       | Prompt/config build | Model binding      | `iso-eval` runner | `iso-trace` parser | `model-score` |
| ------------- | ------------------- | ------------------ | ----------------- | ------------------ | ------------- |
| Claude Code   | yes                 | yes                | yes               | yes                | yes           |
| Codex         | yes                 | yes                | yes               | yes                | yes           |
| OpenCode      | yes                 | yes                | yes               | yes                | yes           |
| Cursor        | yes                 | advisory note only | yes               | yes                | not yet       |

## Tiny-Model Loop

If the real target is "the same workflow still works on smaller models,"
the repo now supports a tighter loop:

- `isolint` rewrites authored prose into smaller-model-safe instructions.
- `iso-route` lets you pin cheaper or local roles without forking prompts.
- `iso-capabilities check/render` keeps role permission matrices local
  instead of repeating tool/MCP/filesystem boundaries in prompts.
- `iso-trace model-score` catches tool-schema failures that weaker routes
  tend to surface first on Claude Code, Codex, and OpenCode.
- `iso-trace export-fixture --runner <name>` turns a real failure into an
  `iso-eval` suite you can replay across shipped runners.
- `iso-contract validate/render` makes artifact formats deterministic
  instead of repeatedly restating TSV/JSON/markdown layouts in prompts.
- `iso-ledger append/query/has` gives workflows a deterministic source of
  operational truth instead of repeated markdown/TSV scraping.
- `iso-guard audit` checks whether a real run obeyed operational policy
  without turning those rules into more prompt tokens.

## Runtime Control

The runtime layer is intentionally MCP-free and model-free. Domain packages
can use it from ordinary Node scripts to keep expensive or fragile facts out
of the prompt:

- `iso-orchestrator` persists resumable `step()` results, mutexes work by
  entity key, and bounds fan-out for side-effectful workflows.
- `iso-capabilities` makes role boundaries executable: resolve inherited
  tool/MCP/command/filesystem/network policy, check proposed actions, and
  render compact harness guidance without asking a model to remember a
  permission matrix.
- `iso-contract` makes artifact shape executable: validate records, parse
  existing TSV/markdown/JSON, and render canonical output without asking a
  model to remember delimiters.
- `iso-ledger` records append-only local events with idempotency keys, then
  answers cheap `has/query/materialize` questions without loading growing
  tracker files into context.
- `iso-guard` audits the normalized event streams from real runs so runtime
  policy stays verifiable after deploy.

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

- **[`packages/iso-route`](./packages/iso-route)** — [`@razroo/iso-route`](https://www.npmjs.com/package/@razroo/iso-route)
  One model policy, every harness. Declare a default model plus named
  roles (`planner`, `fast-edit`, `reviewer`, …) in a single
  `models.yaml`; iso-route compiles that into `.claude/settings.json`,
  `.codex/config.toml`, `opencode.json`, and a resolved role map that
  `iso-harness` consumes when stamping per-subagent frontmatter. Honest
  about ceilings — warns loudly where a harness (e.g. Cursor) can't bind
  models programmatically.

- **[`packages/iso-eval`](./packages/iso-eval)** — [`@razroo/iso-eval`](https://www.npmjs.com/package/@razroo/iso-eval)
  Behavioral eval runner for the produced harness. Snapshots a workspace
  per task, hands it to a runner with the task prompt, then scores the
  resulting filesystem / command state — answering "did the agent
  actually do it?" that structural and prose lints can't. Ships a
  deterministic `fake` runner for CI smoke plus packaged real runners for
  Cursor, Codex, Claude Code, and OpenCode. The library still accepts
  custom `RunnerFn`s for teams that need a different invocation surface.

- **[`packages/iso-trace`](./packages/iso-trace)** — [`@razroo/iso-trace`](https://www.npmjs.com/package/@razroo/iso-trace)
  Local observability for real agent transcripts. Parses Claude Code,
  Cursor, Codex, and OpenCode sessions into a harness-agnostic event model so
  you can ask "which rules ever actually fired?", "which
  tools does my agent reach for most?", and "which captured sessions
  would make good regression fixtures?" Ships redacted export / fixture
  helpers so that feedback loop is easier to reuse safely. `model-score`
  currently stays on Claude Code, Codex, and OpenCode because Cursor
  transcripts do not yet expose stable model metadata. Zero upload —
  everything is local reads and user-controlled output.

- **[`packages/iso-guard`](./packages/iso-guard)** — [`@razroo/iso-guard`](https://www.npmjs.com/package/@razroo/iso-guard)
  Deterministic runtime policy checks for agent workflows. Reads normalized
  event streams or `iso-trace export` JSON/JSONL and verifies invariants
  such as bounded fan-out, cleanup-before-dispatch, required follow-up
  commands, no overlapping same-key work, and prompt secret redaction.
  No model calls, no MCP server, and no injected prompt overhead.

- **[`packages/iso-ledger`](./packages/iso-ledger)** — [`@razroo/iso-ledger`](https://www.npmjs.com/package/@razroo/iso-ledger)
  Append-only operational state for agent workflows. Stores local JSONL
  events with deterministic ids and idempotency keys, supports
  `append/query/has/verify/materialize`, and gives domain packages a
  canonical state source without loading tracker files into the prompt.

- **[`packages/iso-contract`](./packages/iso-contract)** — [`@razroo/iso-contract`](https://www.npmjs.com/package/@razroo/iso-contract)
  Deterministic artifact contracts for agent workflows. Loads JSON
  contract catalogs, validates records, and parses/renders JSON, TSV,
  and markdown table rows so domain packages can keep artifact formats
  out of prompt prose.

- **[`packages/iso-capabilities`](./packages/iso-capabilities)** — [`@razroo/iso-capabilities`](https://www.npmjs.com/package/@razroo/iso-capabilities)
  Deterministic role capability policies for agent workflows. Loads JSON
  role catalogs, resolves inheritance, checks proposed tool/MCP/command/
  filesystem/network access, and renders compact target guidance so
  domain packages can keep permission matrices out of prompt prose.

- **[`packages/iso-orchestrator`](./packages/iso-orchestrator)** — [`@razroo/iso-orchestrator`](https://www.npmjs.com/package/@razroo/iso-orchestrator)
  Durable orchestration primitives for the runtime layer above a single
  agent session. Persists workflow state to local disk, memoizes
  load-bearing `step()` results, provides keyed mutexes for "same
  entity" exclusion, and offers bounded `forEach()` fan-out so domain
  packages can move invariants out of prompt prose and shell scripts.
  Library-first today: no CLI, no harness-specific task-dispatch adapter.

Each package is independently published on npm and works on its own.
They're in one repo because they're designed to compose.

**Working on integrations across packages?** Read
[`INTEGRATIONS.md`](./INTEGRATIONS.md). It now serves as the shipped
composition ledger plus the list of deliberate non-integrations, so an
AI agent (or human) pointed at this repo can tell what is already wired
up vs. what is intentionally kept decoupled.

## Commands cheat sheet

Install any one package globally or per-project; every CLI below is the
bin exposed by that package.

### `@razroo/iso` — wrapper (recommended)

```bash
iso build                         # run agentmd → isolint → iso-harness on ./
iso build path/to/project         # target another project
iso build . --out dist            # write generated harness files under ./dist
iso build . --target claude,cursor
iso build . --skip-isolint        # skip the portable-prose pass
iso build . --dry-run             # dry-run the final iso-harness write
iso plan  .                       # print planned steps without executing
```

### `@razroo/agentmd` — author structure

```bash
agentmd lint   <file>                                     # structural lint (rule IDs, refs, why:)
agentmd render <file> [--out compiled.md]                 # render compiled prompt with scope labels
agentmd test   <file> --fixtures <path> [--via api|claude-code] [--model <id>]
```

### `@razroo/isolint` — portable prose

```bash
isolint lint .                                            # default preset
isolint lint . --preset recommended,performance
isolint lint . --since origin/main --fail-on warn         # gate PRs
isolint lint . --format sarif > lint.sarif                # for GitHub code scanning
isolint lint . --fix --llm --large anthropic/claude-3.5-sonnet
isolint plan  <spec>                                      # generate portable instructions from a plan
```

### `@razroo/iso-harness` — fan out to every harness

```bash
iso-harness build                                         # reads ./iso, writes to ./
iso-harness build --target claude,cursor                  # subset of targets
iso-harness build --source path/to/iso --out path/to/project
iso-harness build --dry-run                               # print planned writes
iso-harness build --watch                                 # rebuild on every source change
```

### `@razroo/iso-route` — one model policy, every harness

```bash
iso-route build models.yaml --out .                       # emit .claude/settings.json, config.toml, etc.
iso-route build models.yaml --targets claude,codex        # subset of harnesses
iso-route build models.yaml --dry-run                     # preview without touching disk
iso-route build models.yaml --verify-models               # opt-in early model verification
iso-route plan  models.yaml                               # print resolved role table
iso-route verify models.yaml                              # verify model IDs without emitting files
```

### `@razroo/iso-eval` — did the agent actually do the task?

```bash
iso-eval run  eval.yml                                    # run the suite
iso-eval run  eval.yml --filter write-greeting --concurrency 2 --json
iso-eval run  eval.yml --runner claude-code --harness-source dist
iso-eval run  eval.yml --runner cursor --harness-source dist
iso-eval run  eval.yml --runner opencode --harness-source dist
iso-eval run  eval.yml --keep-workspaces                  # keep tmpdirs for debugging
iso-eval plan eval.yml                                    # list tasks + checks, no execution
```

### `@razroo/iso-trace` — what the agent *actually* did (production)

```bash
iso-trace sources                                         # detected transcript roots + parser status
iso-trace list                                            # recent sessions across every root
iso-trace list --since 7d --cwd .
iso-trace show <id-or-prefix> [--events tool_call,file_op]
iso-trace show <id> --grep "H3"                           # regex across messages + tool input
iso-trace stats [ids…] [--since 7d] [--cwd .]             # aggregate tool/rule stats
iso-trace stats --source path/to/sample.jsonl             # one file, no discovery
iso-trace model-score --cwd . --harness opencode --tool read
iso-trace model-score --cwd . --harness opencode --tool read --since-hours 24 --fail-on-schema
iso-trace model-score --cwd . --harness opencode --tool read --since-hours 24 --fail-on-model openrouter/z-ai/glm-4.5-air:free
iso-trace export <id> --format jsonl --redact > session.jsonl
iso-trace export-fixture <id> --out fixtures/my-task --runner codex --edit-checks exists-only --run
```

### `@razroo/iso-guard` — did the run obey policy?

```bash
iso-guard audit guard.yaml --events session.json
iso-guard audit guard.yaml --events session.jsonl --json
iso-guard verify guard.yaml --events session.json --fail-on warn
iso-guard explain guard.yaml
```

### `@razroo/iso-ledger` — what is canonically true?

```bash
iso-ledger init
iso-ledger append application.submitted --key "url:https://example.test/jobs/123" --idempotency-key "apply:https://example.test/jobs/123" --data '{"status":"applied"}'
iso-ledger has --key "url:https://example.test/jobs/123"
iso-ledger query --type application.submitted --where status=applied
iso-ledger verify
iso-ledger materialize --out state.json
```

### `@razroo/iso-contract` — what shape must this artifact have?

```bash
iso-contract list --contracts contracts.json
iso-contract explain jobforge.tracker-row --contracts contracts.json
iso-contract validate jobforge.tracker-row --contracts contracts.json --input @row.json
iso-contract render jobforge.tracker-row --contracts contracts.json --input @row.json --format tsv
iso-contract parse jobforge.tracker-row --contracts contracts.json --format tsv --input "812	2026-04-26	Example Labs	Staff Agent Engineer	Applied	4.2/5	yes	[812](reports/812-example-labs-2026-04-26.md)	Submitted"
```

### `@razroo/iso-capabilities` — what may this role do?

```bash
iso-capabilities list --policy capabilities.json
iso-capabilities explain applicant --policy capabilities.json
iso-capabilities check applicant --policy capabilities.json --tool browser --mcp geometra --command "npx job-forge merge" --filesystem write --network restricted
iso-capabilities render applicant --policy capabilities.json --target opencode
```

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
    ├── iso-route/        # one model policy → per-harness config
    ├── iso-orchestrator/ # durable runtime control above one agent session
    ├── iso-eval/         # behavioral eval on the produced harness
    ├── iso-trace/        # parse + query real agent transcripts (observability)
    ├── iso-guard/        # deterministic runtime policy checks over events
    ├── iso-ledger/       # append-only operational event/state ledger
    ├── iso-contract/     # deterministic artifact contracts
    └── iso-capabilities/ # deterministic role capability policy
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
npm --workspace @razroo/iso-eval  run example   # iso-eval against the bundled example suite
npm --workspace @razroo/iso-trace run example   # iso-trace stats on the bundled sample transcript
npm --workspace @razroo/iso-guard run test      # iso-guard policy engine tests
npm --workspace @razroo/iso-ledger run test     # iso-ledger event/state tests
npm --workspace @razroo/iso-contract run test   # iso-contract artifact contract tests
npm --workspace @razroo/iso-capabilities run test # iso-capabilities policy tests

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
that exercises **seven of the twelve packages end-to-end** in one `npm run
test:pipeline` invocation: `agentmd lint` + `render` → `isolint lint` →
`iso-route build` (from a bundled `models.yaml` that extends the
`standard` preset) → `iso-harness build` (which consumes iso-route's
resolved map and stamps `model:` onto the Claude subagent) →
`iso-eval run` against a tiny fake-runner suite → `iso-trace stats`
against a bundled sample session. The assertion set includes a
cross-package check that the `researcher` subagent's emitted
frontmatter contains `model: claude-opus-4-7`, driven from the
`models.yaml` policy.

[`examples/dogfood/`](./examples/dogfood) is a local dogfood project for the
wrapper CLI itself. It starts from `agent.md` + `iso/` source and runs the
repo's local `packages/iso/bin/iso.mjs` entrypoint to produce the full harness
fan-out. Run `npm run test:dogfood` to exercise the same wrapper path a
downstream repo would use.

`npm run test:pack` goes one level further: it packs the local workspaces into
tarballs, installs them into fresh temp projects, and smoke-tests the packaged
`iso-harness`, `iso`, `iso-eval`, `iso-trace`, `iso-route`, `iso-guard`, `iso-ledger`, `iso-contract`, and `iso-capabilities`
CLIs. This guards against packaging regressions that workspace-only tests can
miss.

[`packages/iso-eval/examples/suites/echo-basic/`](./packages/iso-eval/examples/suites/echo-basic)
is a runnable eval suite for the downstream side: a baseline workspace, a
task prompt, and a set of file/command checks. Run `npm --workspace
@razroo/iso-eval run example` to see the full pass-report against the
bundled `fake` runner.

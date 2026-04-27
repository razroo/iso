# @razroo/iso

**One command that runs the full authored-source pipeline:**
`agentmd` → `isolint` → `iso-route` (when `models.yaml` exists) →
`iso-harness`.

If `agent.md` is your source of truth, `@razroo/iso` is the wrapper CLI
that turns it into every coding-agent harness layout in one shot.

## What it does

Given a project like this:

```text
my-project/
├── agent.md
├── models.yaml        # optional — triggers the iso-route step
└── iso/
    ├── agents/
    ├── commands/
    └── mcp.json
```

`iso build` will:

1. Lint `agent.md` structurally with `agentmd lint`
2. Render it to `iso/instructions.md` with `agentmd render`
3. Lint the rendered prose with `isolint lint`
4. (When `models.yaml` or `iso/models.yaml` exists) Compile the model
   policy with `iso-route build` so the resolved role map is on disk
   when the next step reads it
5. Fan the `iso/` directory out to Claude Code, Cursor, Codex, OpenCode, and Pi
   with `iso-harness build` — which picks up the resolved map from
   step 4 and stamps per-subagent `model:` fields automatically

If the project has no `agent.md`, the wrapper skips the `agentmd` steps
and uses the existing `iso/instructions.md` as-is.

## Example run

Running `iso build` against the [`examples/dogfood`](../../examples/dogfood)
project in this repo:

```text
▶ agentmd lint (structural check)
agent.md: ok (0 diagnostics)

▶ agentmd render → iso/instructions.md
wrote iso/instructions.md

▶ isolint lint (portable prose)
1 file scanned — no findings

▶ iso-harness build (fan out to all supported harnesses)
iso-harness: loaded 1 agent(s), 1 command(s), 1 MCP server(s) from iso/
  [claude]   wrote 4 file(s) — CLAUDE.md, .claude/agents/*, .claude/commands/*, .mcp.json
  [cursor]   wrote 3 file(s) — .cursor/rules/*, .cursor/mcp.json
  [codex]    wrote 2 file(s) — AGENTS.md, .codex/config.toml
  [opencode] wrote 4 file(s) — AGENTS.md, .opencode/agents/*, .opencode/skills/*, opencode.json
  [pi]       wrote 3 file(s) — AGENTS.md, .pi/skills/*, .pi/prompts/*
```

Each step runs in sequence and fails loudly on the first non-zero exit,
so a broken authored source never produces a half-written harness tree.

## Install

```bash
npm install -D @razroo/iso
```

Or run it ad hoc:

```bash
npx @razroo/iso build .
```

## Usage

```bash
iso build                         # run the full pipeline for ./
iso build path/to/project         # target another project
iso build . --out dist            # write generated harness files under ./dist
iso build . --target claude,cursor
iso build . --skip-isolint        # skip the portable-prose lint pass
iso build . --skip-iso-route      # skip the model-policy compile step
iso build . --dry-run             # dry-run iso-route + iso-harness writes

iso plan .                        # print the planned steps without executing
```

`--out` resolves relative to the project directory you pass to `iso`.
`--target` is forwarded to both `iso-route` and `iso-harness`, so a
targeted build only emits model config and harness files for that target set.

`--dry-run` propagates to both `iso-route build` and `iso-harness build`
so no files are written. `agent.md` and `iso/instructions.md` are still
refreshed (those are the author's source, not generated output).

`--skip-iso-route` is only meaningful when a `models.yaml` exists — if
there's no model policy, the wrapper skips the step automatically.

This repo includes [`examples/dogfood/`](../../examples/dogfood) as a local
project that exercises the wrapper against a real `agent.md` + `iso/` source
tree.

## Library API

```js
import { planPipeline, runPipeline } from '@razroo/iso';

const plan = planPipeline('/path/to/project', { target: 'claude,cursor' });
runPipeline('/path/to/project', { out: 'dist' });
```

`planPipeline(projectDir, opts)` returns the resolved project dir, output
dir, whether `agent.md` was present, and the exact subprocess steps that
would run.

`runPipeline(projectDir, opts)` executes those steps in order and returns
the same plan object.

## Relationship to the other packages

- Use **`@razroo/agentmd`** when you only want the structural authored-source
  dialect and adherence tooling.
- Use **`@razroo/isolint`** when you want portability linting / rewriting on
  existing harness prose.
- Use **`@razroo/iso-harness`** when you already have a clean `iso/`
  directory and only need harness fan-out.
- Use **`@razroo/iso-route`** when you only want to compile a model
  policy into per-harness config (without touching prompts). Under the
  wrapper, it runs automatically whenever `models.yaml` is present.
- Use **`@razroo/iso`** when you want the whole pipeline behind one command.

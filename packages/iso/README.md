# @razroo/iso

**One command that runs the full authored-source pipeline:**
`agentmd` → `isolint` → `iso-harness`.

If `agent.md` is your source of truth, `@razroo/iso` is the wrapper CLI
that turns it into every coding-agent harness layout in one shot.

## What it does

Given a project like this:

```text
my-project/
├── agent.md
└── iso/
    ├── agents/
    ├── commands/
    └── mcp.json
```

`iso build` will:

1. Lint `agent.md` structurally with `agentmd lint`
2. Render it to `iso/instructions.md` with `agentmd render`
3. Lint the rendered prose with `isolint lint`
4. Fan the `iso/` directory out to Claude Code, Cursor, Codex, and OpenCode
   with `iso-harness build`

If the project has no `agent.md`, the wrapper skips the `agentmd` steps
and uses the existing `iso/instructions.md` as-is.

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
iso build . --dry-run             # only dry-run the final iso-harness write

iso plan .                        # print the planned steps without executing
```

`--out` resolves relative to the project directory you pass to `iso`.

`--dry-run` only affects the final `iso-harness build` step. If `agent.md`
is present, the wrapper still refreshes `iso/instructions.md` before the
dry-run fan-out.

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
- Use **`@razroo/iso`** when you want the whole pipeline behind one command.

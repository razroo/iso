# agentmd

A structured-markdown dialect for authoring LLM agent prompts, plus a linter
for structure and a fixture-driven harness that measures per-rule adherence
against a target model.

## What this repo is

Two things:

1. A **format**: markdown with conventions (`# Agent: <name>`; rules under
   `## Hard limits` / `## Defaults` shaped `- [H1] claim` + indented `why:`;
   `## Procedure` with numbered steps that cross-reference rule IDs;
   `## Routing` table with a fallback row). See `examples/outreach-writer.md`.
2. A **CLI (`agentmd`)** that lints the structure, renders the compiled
   prompt, and runs fixture cases through Claude to report per-rule pass
   rate.

Rule IDs use scope prefixes: `H#` for hard limits (never violate), `D#` for
defaults (overridable with an explicit stated reason). Every rule must have
a `why:` — the model uses it to judge edge cases.

## Layout

```
src/
  types.ts          AST shapes
  parser.ts         markdown → AST (hand-rolled; no remark dep)
  render.ts         AST → compiled prompt (adds scope labels)
  linter.ts         L1–L13 structural checks
  checks.ts         word_count_le / does_not_contain / contains_all / regex / llm_judge
  fixtures.ts       YAML loader
  runner.ts         wires prompt + fixtures + agent (pluggable AgentFn / JudgeFn)
  anthropic.ts      SDK-based AgentFn / JudgeFn
  claude-code.ts    subprocess-based AgentFn / JudgeFn (`claude -p`)
  report.ts         per-rule adherence formatting
  cli.ts            lint / render / test
examples/           outreach-writer.md + fixtures/outreach-writer.yml
tests/              node:test suites (parser, linter, checks, runner, claude-code)
bin/agentmd         tsx entry shim
```

## Commands

```
./bin/agentmd lint <file>
./bin/agentmd render <file> [--out <path>]
./bin/agentmd test <file> --fixtures <path> [--via api|claude-code] [--model <id>] [--verbose]

npm test            # node:test suites
npm run typecheck   # tsc --noEmit
```

`--via claude-code` (default when no API key is exported) shells out to
`claude -p` with `--tools ""`, `--system-prompt <rendered>`,
`--no-session-persistence`, and `cwd = os.tmpdir()` so no project
`CLAUDE.md` leaks into the test. `--via api` hits the Anthropic SDK directly
and needs `ANTHROPIC_API_KEY`.

## Conventions to preserve when editing

- **Hand-rolled parser.** Don't pull in remark / unified. The format is
  regular enough that a line-based parser keeps the dep surface tiny.
- **Structure, not words.** The linter deliberately does not check for
  vague words ("good", "nice") — that's cargo-cult. If you add a rule, it
  should catch a structural bug (missing rationale, dangling ref, missing
  fallback row). See the list at L1–L13 in `src/linter.ts`.
- **Pluggable agent/judge.** `runner.ts` takes an `AgentFn` and optional
  `JudgeFn` so tests run offline against a fake. Don't import the Anthropic
  SDK or spawn `claude` from anywhere other than `src/anthropic.ts` /
  `src/claude-code.ts`.
- **Judge convention:** phrase `llm_judge` prompts so `yes` means "rule
  followed", not "rule violated". Every fixture that gets this backwards
  reports rule violations as passes.
- **No marketing copy in prompts.** When you add an example, don't write
  something aspirational — write something the harness can actually score.

## Working with isolint

`agentmd` checks the **structure** of your agent prompt.
[`isolint`](https://github.com/razroo/isolint) checks the **prose** — catches
phrases weak small models can't parse (`should`, `when relevant`,
`one of the usual categories`, long sentences, unclosed `etc.` lists, taste
words, etc.). The two compose naturally:

```
authored.md
   │  agentmd lint         ← structure holds (IDs, refs, scope, fallback)
   ▼
authored.md
   │  agentmd render       ← compiled prompt with scope labels
   ▼
compiled.md
   │  isolint lint [--fix --llm]   ← if the prompt will run on weaker models
   ▼
compiled-portable.md
   │  agentmd test --fixtures …    ← measure adherence on the target model
   ▼
adherence report
```

**Load-bearing interop:** isolint recognises agentmd-dialect files (by the
`# Agent: <name>` H1) and skips `perf-rationale-in-shared-prefix` on them,
because agentmd treats the `why:` lines as load-bearing context the model
uses to judge edge cases. Don't try to run isolint's performance preset
against an agentmd file and expect it to flag the rationale — it won't, by
design.

If you're running both in CI, run `agentmd lint` first (fast, catches
structural bugs early), then `isolint lint` on the rendered output.

## Commit hygiene

- Prefer `git add <paths>` over `git add -A` — avoid staging `.env`,
  scratch notes, etc.
- The `package.json` name is `agentmd`; the bin is `./bin/agentmd`; the
  GitHub remote is `razroo/agentmd`. All four should stay in sync if you
  ever rename.

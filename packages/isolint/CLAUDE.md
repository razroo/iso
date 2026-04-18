# isolint

Lints AI harness markdown so weak small models (Minimax 2.5, Nemotron 3,
Mistral 7B, local models) can execute it reliably, and rewrites the bad
prose with `--fix --llm`. Also ships an Isomorphic Plan engine (`isolint
plan` / `run`) for fully-deterministic pipelines.

## What this repo is

Two products in one package:

1. **Linter** (`isolint lint`) — 28 deterministic + 5 LLM-assisted prose
   rules, each targeting a concrete small-model failure mode. Plus an
   optional `performance` preset with 17 advisory rules for harness
   overhead (repeated instructions, oversized examples, rationale in
   always-loaded files, saturated emphasis, cross-file duplication, etc.).
2. **Plan engine** (`isolint plan` / `run` / `validate`) — large model
   emits a strict JSON plan; small model executes it with per-step schema
   validation.

Every LLM rewrite is re-linted before being applied (rule that fired must
stop firing; no new rules may fire; markdown structure preserved), so
`--fix --llm` is safe in CI. See the README for the full rule list and CLI
surface.

## Layout

```
src/
├── lint/
│   ├── rules/              Individual rules
│   │   ├── deterministic.ts   # soft-imperative, taste-word, ...
│   │   ├── performance.ts     # perf-* rules (the advisory preset)
│   │   ├── llm.ts             # opt-in LLM-assisted rules
│   │   ├── frontmatter.ts
│   │   └── custom.ts          # .isolint.json custom_rules[]
│   ├── ast.ts              # remark/unified parse + helpers (paragraphs/headings/…)
│   ├── dialect.ts          # Content-based dialect detection (isAgentmdFile)
│   ├── paths.ts            # Path-based classification (SHARED_PREFIX_PATH_RE, …)
│   ├── source.ts           # computeSkipIntervals (code fences, HTML comments, …)
│   ├── sections.ts, sentences.ts, suppressions.ts, fix.ts, runner.ts, preset.ts
├── schema/                 Plan schema (strict)
├── planner/                Large-model → Plan JSON
├── runtime/                Small-model step executor
├── providers/              OpenAI / OpenRouter / Ollama / Mock
└── cli/                    isolint lint | verify | plan | run | validate

test/                       node --test suites (174 tests at time of writing)
examples/                   cold-email, data-extraction, multi-step-reasoning
```

## Commands

```
npm run build         # tsc → dist/
npm run typecheck     # tsc --noEmit
npm test              # tsx --test test/*.test.ts
npm run check:plans   # validate bundled example plans
```

`npx @razroo/isolint lint ./modes` — run the linter.
`--fix --llm` to rewrite, `--since origin/main` for PR-only runs,
`--format sarif` for CI.

## Conventions to preserve when editing

- **Every new rule targets one concrete small-model failure mode.** If
  you can't name the specific failure ("drops `should` clauses",
  "inherits numbered-step gaps"), the rule doesn't belong here.
- **Skip-spans first.** Before a rule fires, it must respect the skips
  (code fences, inline code, HTML comments, frontmatter, short-quoted
  phrases). See `src/lint/source.ts` and how `sentenceSkips(ctx)` in
  `performance.ts` funnels through them.
- **Examples in rule bodies are self-tests.** Every rule with `examples:
  [{ bad, good, ... }]` has its `bad` fixture asserted to trigger the
  rule and `good` asserted not to. Don't ship a `bad` that doesn't fire.
- **Path classification stays in `paths.ts`. Content classification goes
  in `dialect.ts`.** Path-based rules ("this is AGENTS.md") look at
  `ctx.file`; content-based rules ("this is an agentmd file") look at the
  AST or text. Don't mix them.
- **Re-lint every rewrite.** The fix engine re-runs rules against the
  rewritten text before accepting. If you add a new fix path, route it
  through `validate-rewrite.ts` — never write raw model output to disk.

## Working with agentmd

[`agentmd`](https://github.com/razroo/agentmd) is a structured-markdown
dialect for authoring LLM agent prompts. It uses `# Agent: <name>` as the
H1, has `## Hard limits` / `## Defaults` sections with rules shaped
`- [H1] claim` + indented `why: rationale`, and treats those `why:` lines
as **load-bearing** — the model uses them to judge edge cases.

isolint already recognises this dialect. Specifically:

- `src/lint/dialect.ts` exports `isAgentmdFile(ctx)`, which returns true
  when the file has a `# Agent: <name>` H1.
- `perf-rationale-in-shared-prefix` (in `performance.ts`) early-returns on
  agentmd files. Otherwise it would flag the rationale blocks that the
  author intentionally wrote for the model to read.
- No other isolint rule conflicts with agentmd today:
  - `placeholder-leftover` matches `[INSERT…]`, `[TBD]`, `[TODO]`, not
    `[H1]` / `[D1]`.
  - `soft-imperative`, `taste-word`, `long-sentence`, etc. should still
    apply to agentmd rule claims — catching a `should` in a rule claim is
    desirable.
- If you add a new rule and notice it false-positives on an agentmd file,
  the pattern is: add an early-return guarded by `isAgentmdFile(ctx)`, and
  add a test in `test/performance.test.ts` (or wherever) that asserts the
  rule does NOT fire on a minimal agentmd sample while still firing on the
  non-agentmd equivalent.

Recommended pipeline in downstream projects that use both tools:

```
agentmd lint → agentmd render → isolint lint [--fix --llm] → agentmd test --fixtures …
```

agentmd validates the structure first (cheap, catches structural bugs
before any prose scrutiny); isolint hardens the compiled prose for weaker
models; agentmd test measures whether the target model actually follows
the rules.

## Commit hygiene

- Prefer `git add <paths>` over `git add -A`.
- `prepublishOnly` rebuilds and runs the full test suite — keep both green
  before bumping the version.

<p align="center">
  <img src="./logo.svg" alt="isolint" width="360">
</p>

# Isolint

[![npm](https://img.shields.io/npm/v/@razroo/isolint.svg)](https://www.npmjs.com/package/@razroo/isolint)
[![CI](https://github.com/razroo/isolint/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/razroo/isolint/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@razroo/isolint.svg)](./LICENSE)

> Lint your AI harness so weak small models can actually run it.
> Finds the phrasing that breaks Minimax 2.5, Nemotron 3, Mistral 7B,
> and local models — then rewrites it with a smart model.

You author a harness (opencode modes, Claude Code agent files, Cursor rules,
plain `.md` skills) with a frontier model. You want to run it on a cheap
small model. The logic is fine — but the **prose** is full of phrases
that only a frontier model knows how to interpret:
`should`, `when relevant`, `one of the usual categories`, `the table above`,
`creative`, `leveraged`. Small models drop clauses, invent items, ignore
soft imperatives, and blow past taste words.

Isolint fixes that:

```
┌─────────────────┐           ┌─────────────────────┐           ┌─────────────────┐
│  Your harness   │  isolint  │  Lint report + diff │  --fix    │  Same harness,  │
│  (.md files)    │ ────────▶ │  of every phrase    │ ────────▶ │  small-model-   │
│                 │           │  a 7B model misses  │           │  safe prose     │
└─────────────────┘           └─────────────────────┘           └─────────────────┘
```

Isolint also ships an **Isomorphic Plan** engine (`isolint plan` / `run`) —
a large model emits a strict JSON plan; a small model executes it with
schema validation. The linter uses this engine internally for its
LLM-assisted rules. Use it directly when you want a fully-deterministic
pipeline instead of markdown prose.

## Contents

- [Why](#why)
- [Architecture](#architecture)
- [The linter](#the-linter-the-practical-win)
- [Plans](#plans-the-compiler-mode)
- [Install](#install)
- [CLI](#cli)
- [Examples](#examples)
- [Programmatic API](#programmatic-api)
- [Tests](#tests)

## Why

Most "agent" systems push all complexity into runtime prose: long system
prompts, sprawling instructions, taste-based validation. 7B-class models
collapse under that weight — not because the logic is wrong, but because
the prose is ambiguous.

The default `recommended` preset scans for **28 deterministic rule patterns
+ 5 LLM-assisted rules**, each targeting one concrete small-model failure
mode. An optional `performance` preset adds 18 advisory rules for harness
overhead: repeated instructions, oversized examples, redundant contracts,
low-value prose, saturated emphasis, mode-conditional branches in shared
prefixes, cross-file duplication, and other avoidable token/latency costs.
Every finding is a fixable phrase. Every fix preserves intent and markdown
formatting — and every LLM rewrite is re-linted before being applied so bad
fixes never ship.

## Architecture

```
src/
├── lint/        # Markdown harness linter (deterministic + LLM-assisted)
│   ├── rules/   # Individual rules (soft-imperative, taste-word, ...)
│   ├── fix.ts   # Deterministic fix engine + LLM rewriter
│   └── ...
├── schema/      # Strict Plan schema (the contract)
├── planner/     # Large-model → Plan (JSON)
├── runtime/     # Small-model executor (validates every step)
├── providers/   # OpenAI / OpenRouter / Ollama / Mock
├── util/        # JSON extraction, logger
└── cli/         # isolint lint | verify | plan | run | validate
```

## The Linter (the practical win)

<!-- isolint-disable-next-line long-sentence -->
If you use Claude Code / Codex / Cursor to author a harness and then run it
on minimax / nemotron / local models, the #1 failure mode is not logic — it's
**prose the small model can't parse**. The linter catches that.

### What it flags

Every rule targets a concrete failure mode in weak models. All rules run
against fenced code blocks, inline code, and HTML comments are skipped.

<!-- isolint-disable -->

| Rule | Catches | Severity |
| --- | --- | --- |
| `soft-imperative` | `should`, `could`, `might`, `consider`, `ideally` — weak models drop these | warn |
| `vague-quantifier` | `some`, `several`, `a few`, `many`, `most` without a number | warn |
| `taste-word` | `creative`, `engaging`, `passionate`, `leveraged`, `cutting-edge`, etc. | warn |
| `ambiguous-deictic` | `the table above`, `as mentioned below` — position-based refs | info |
| `double-negation` | `don't forget to not skip…` — weak models flip the sign | warn |
| `long-sentence` | Sentences > 35 words — weak models drop clauses | info |
| `pronoun-no-antecedent` | `It`, `This`, `They` at start of block after a list/heading | info |
| `enum-without-list` | `one of the usual categories` without the list inline | warn |
| `word-count-target` | `write 100 words` — weak models count tokens poorly | info |
| `implicit-conditional` | `when relevant`, `if appropriate`, `as needed` | warn |
| `trailing-etc` | `A, B, C, etc.` — unclosed set, weak models invent items | warn |
| `heading-without-imperative` | Mode headings without an action verb | info |
| `nested-conditional` | Multiple `if` / `unless` / `except` in one sentence | warn |
| `multiple-output-formats` | "return JSON and a summary" in one step | warn |
| `placeholder-leftover` | `TODO`, `FIXME`, `<insert X>`, `[INSERT X]` — weak models echo scaffolding | warn |
| `output-format-no-example` | "return JSON" with no example, schema, or field list nearby | warn |
| `numbered-step-gap` | `1. … 2. … 4. …` — weak models inherit the gap and skip the step | warn |
| `step-without-verb` | `## Step N` body that opens with a noun, not an imperative verb | info |
| `undefined-step-reference` | Prose mentions `Step 5` when only 3 steps exist across the harness | warn |
| `missing-file-reference` | `Read cv.md` when `cv.md` doesn't exist in the repo | warn |
| `context-budget` | Harness file over the prose-length budget — weak models drop the middle | info / warn |
| `dangling-variable-reference` | `$input.X` / `$steps.Y.output` with no declared source — weak models hallucinate the value | warn |
| `invalid-json-fence` | ` ```json ` fence body that doesn't parse as JSON — weak models copy the malformed shape | warn |
| `heading-hierarchy` | Skipped heading levels (`# A` → `### B`) — weak models use depth as structure | info |
| `stale-link-reference` | `[label](./missing.md)` where the target isn't in the repo | warn |
| `table-column-mismatch` | Table rows with different cell counts than the header | warn |
| `mixed-list-marker` | One list mixes `-` and `*` markers — weak models split on the change | info |
| `frontmatter-schema` | Harness frontmatter missing required fields (Claude Code `description`, Cursor `globs`/`alwaysApply`) | warn |

<!-- isolint-enable -->

Plus five **LLM-assisted** rules (opt-in via `--llm`) that use a smart
model with JSON-mode output for checks that need judgment:

| Rule | Catches |
| --- | --- |
| `llm-atomicity` | Instructions bundling multiple actions into one sentence |
| `llm-implicit-context` | Phrases that rely on context not present in the file |
| `llm-unexplained-schema` | Output contracts in prose with no example / schema nearby |
| `llm-tone-drift` | Authoritative imperatives followed by casual phrasing in the same section |
| `llm-implicit-assumption` | Sentences that reference entities with no prior definition |

### Quick start

```bash
# Scan any directory of .md / .mdc / .mdx files — reliability + performance by default
npx @razroo/isolint lint /path/to/harness

# Reliability rules only (opt out of performance)
npx @razroo/isolint lint /path/to/harness --preset recommended

# Performance rules only (advisory, info-severity)
npx @razroo/isolint lint /path/to/harness --preset performance

# See how many tokens your harness costs per turn (shared prefix + per-mode + per-agent)
npx @razroo/isolint cost /path/to/harness

# Just your opencode modes / Claude Code agents / Cursor rules
npx @razroo/isolint lint .opencode/skills .opencode/agents modes .cursor/rules

# Only lint files changed since main (great for PR CI)
npx @razroo/isolint lint . --since origin/main --fail-on warn

# JSON for CI / GitHub annotations (SARIF)
npx @razroo/isolint lint ./modes --format sarif > lint.sarif

# Auto-fix everything the rules can fix deterministically + via LLM rewrites
export OPENROUTER_API_KEY=sk-or-...
npx @razroo/isolint lint ./modes --fix --llm --large anthropic/claude-3.5-sonnet

# Dry-run: see the diff, don't write files
npx @razroo/isolint lint ./modes --fix --llm --diff
```

`.md`, `.mdc` (Cursor rules), and `.mdx` are all picked up by default. YAML
(`---`) / TOML (`+++`) frontmatter at the top of any file is skipped.

When run inside a git repo, isolint honors `.gitignore` (plus
`.git/info/exclude` and any global git excludes) so build output like
generated `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/` copies don't get
linted. Pass `--no-gitignore` to disable.

### Suppressions

Any file can silence findings with HTML comments:

```markdown
<!-- isolint-disable-next-line taste-word -->
These words (leveraged, cutting-edge, passionate) are ATS red flags.

<!-- isolint-disable -->
This whole block is documentation about banned words, not an instruction.
- leveraged
- utilized
- spearheaded
<!-- isolint-enable -->
```

No rule ids = suppress all rules on the target line(s).

### Config (`.isolint.json`)

Both `.isolint.json` and the legacy `.isomodel-lint.json` are read. Shape:

```json
{
  "extends": ["recommended"],
  "rules": {
    "pronoun-no-antecedent": "off",
    "long-sentence": "warn"
  },
  "ignore": ["docs/archive/**", "*.draft.md"],
  "options": {
    "long-sentence.max_words": 40,
    "taste-word.extra": ["bespoke", "revolutionary"]
  },
  "skip_spans": {
    "quoted_strings": true,
    "quoted_strings_max_chars": 40
  },
  "custom_rules": [
    {
      "id": "no-acme-brand",
      "pattern": "\\bAcme\\s+Corp\\b",
      "severity": "warn",
      "message": "Use 'ACME Inc' instead of 'Acme Corp'"
    }
  ]
}
```

`custom_rules[]` lets a team codify its own banned phrases without patching
isolint. Each spec takes `id` (must not collide with a built-in rule),
`pattern` (regex source), optional `flags` (default `gi`), optional
`severity` (default `warn`), and `message`. Invalid specs are logged to
stderr and skipped — one bad pattern never breaks a whole run.

Presets:

- `recommended` — deterministic reliability rules only; safe for CI.
- `strict` — `recommended` + all five LLM-assisted rules; requires `--llm`.
- `performance` — 18 advisory deterministic rules for harness efficiency.

**Default (no config, no `--preset`)**: `recommended + performance` runs
together. Performance findings are `info` severity so CI exit codes
under the default `--fail-on error` are unaffected. Set
`{"extends": ["recommended"]}` in `.isolint.json` or pass
`--preset recommended` to keep only reliability rules.

Combine `performance` with either reliability preset, either via config:

```json
{
  "extends": ["recommended", "performance"]
}
```

Or directly on the command line with `--preset` (repeatable, or comma-separated):

```bash
npx @razroo/isolint lint . --preset recommended --preset performance
# equivalent to:
npx @razroo/isolint lint . --preset recommended,performance
```

`--preset` overrides the config's `extends` when set — useful for one-off
runs without editing `.isolint.json`. Valid values: `recommended`,
`strict`, `performance`.

With `--fix --llm`, the performance preset can rewrite duplicated output
contracts and redundant schema prose. `perf-style-tone-overhead` also has
a deterministic fix for simple trailing tone/style suffixes.

The `performance` preset adds:

- `perf-repeated-instruction-block`
- `perf-example-heavy-section`
- `perf-duplicated-output-requirement`
- `perf-step-restates-prior-step`
- `perf-low-value-prose-section`
- `perf-shared-prefix-budget`
- `perf-large-example-in-shared-prefix`
- `perf-long-runbook-in-shared-prefix`
- `perf-redundant-schema-prose`
- `perf-structured-output-explanation`
- `perf-style-tone-overhead`
- `perf-mirrored-agent-spec`
- `perf-rationale-in-shared-prefix` — `Why:` / `Historical note:` / dated incident narratives in always-loaded files
- `perf-emphasis-inflation` — saturated MUST / NEVER / CRITICAL density (weak models ignore saturated emphasis)
- `perf-cross-file-duplicate-block` — same paragraph copy-pasted verbatim across ≥2 harness files
- `perf-dense-prohibition-list` — 3+ consecutive `Do not X. Never Y. Must not Z.` sentences that should be a bullet list
- `perf-conditional-mode-branch-in-shared-prefix` — `When the orchestrator dispatches an \`apply\`…` branches that belong in the mode's own file
- `perf-nested-conditional-chain` — sentences chaining 3+ `if/when/unless` conditions that weak models can't track

### `isolint cost` — what does my harness actually cost per turn?

Lint tells you *what's wasteful*; `cost` tells you *how much you're paying*.

```bash
# Quick view: always-loaded baseline + per-mode + per-agent breakdown
npx @razroo/isolint cost /path/to/harness

# Fail CI if the always-loaded cost exceeds a budget
npx @razroo/isolint cost /path/to/harness --budget 10000

# Machine-readable, for scripts / dashboards
npx @razroo/isolint cost /path/to/harness --format json
```

The command reports cost per **tool load group** because different
tools load different subsets of the shared-prefix files — you pay
*one* tool's bundle per turn, not all of them summed together:

- **Claude Code** loads `CLAUDE.md`.
- **AGENTS.md convention** (opencode / Codex CLI / Zed) loads
  `AGENTS.md` + `modes/_shared.md` + `.opencode/instructions.md` when
  those exist.
- **Cursor** loads `.cursor/rules/*.mdc` (frontmatter-aware `alwaysApply`
  filtering is not yet implemented, so the total is a ceiling).
- **Per-mode** files (`modes/<name>.md`) load only when that mode runs.
- **Per-agent** files (`.claude/agents/`, `.opencode/agents/`,
  `iso/agents/`) load only when the orchestrator dispatches.

**iso/instructions.md is authoring source** — it compiles to the
tool-specific files at build time. When a tool's file isn't in the
repo, iso stands in as the compiled-content equivalent so each
tool's cost reflects what you actually pay at runtime.

For shared-prefix files, the text report breaks down the biggest
sections so you can see exactly where the budget is going, then shows
the per-tool totals:

```
Shared-prefix files (section breakdown)

    ~8,072 tokens   iso/instructions.md    4,679 words
      ~920   § Hard Limits — NEVER exceed these numbers            549w
      ~615   § Subagent Routing — which agent for which task       311w
      ~578   § Validation State Lags Behind Actual Field State     337w
    ~4,087 tokens   modes/_shared.md       2,184 words

Per-tool always-loaded cost (pick the tool you actually run)

  Claude Code (CLAUDE.md)                           ~8,072 tokens / turn
      ~8,072   iso/instructions.md
    note: CLAUDE.md not in repo; iso/instructions.md stands in as the compiled content.

  AGENTS.md convention (opencode / Codex / Zed)     ~12,159 tokens / turn
      ~8,072   iso/instructions.md
      ~4,087   modes/_shared.md
    note: AGENTS.md not in repo; iso/instructions.md stands in as the compiled content.

  Cursor (.cursor/rules)                             ~8,072 tokens / turn
      ~8,072   iso/instructions.md
    note: .cursor/rules/ not in repo; iso/instructions.md stands in as the compiled content.

  Worst-case tool: AGENTS.md convention at ~12,159 tokens / turn

Per-mode context (loads when that mode runs)
    ~4,549 tokens   modes/apply.md                2,630 words
    ...
  Worst case (worst tool + heaviest mode): ~16,708 tokens / turn
```

Token estimates use `chars ÷ 4` — the same heuristic
`perf-shared-prefix-budget` uses, so the numbers line up with the
findings. Actual per-provider cost depends on the tokenizer.

**CI guard.** Put this in a workflow step to catch regressions when
someone adds a 500-word "just one more thing" to a shared file:

```yaml
- run: npx @razroo/isolint cost . --budget 10000
```

`--budget` exits non-zero (exit 1) when the **worst-case tool** total
exceeds `N` tokens — i.e. the most expensive tool group's bundle, not
a naive sum across tools.

Other flags: `--no-sections` hides the per-section breakdown,
`--no-gitignore` disables the git allowlist (by default
`cost` and `lint` both skip files git ignores — generated build
output like `CLAUDE.md` from the `agentmd` / iso tooling isn't
counted).

### Working with agentmd

[agentmd](https://github.com/razroo/agentmd) is a structured-markdown
dialect for authoring LLM agent prompts: a `# Agent: <name>` H1,
explicit `## Hard limits` / `## Defaults` sections, and rule items
shaped as `- [H1] claim` with an indented `why:` rationale underneath.
The dialect compiles down to the plain `AGENTS.md` / `CLAUDE.md` /
Cursor rules that tools actually load.

isolint supports agentmd natively:

- **Auto-detected.** A file with a top-level `# Agent: <name>` heading
  is treated as agentmd. No config flag needed.
- **Rationale stays.** In plain harness prose, `Why:` paragraphs in a
  shared-prefix file are overhead —
  `perf-rationale-in-shared-prefix` flags them. In agentmd the
  rationale is *load-bearing* (the model uses `why:` to judge edge
  cases), so that rule skips agentmd files. You can keep rich `why:`
  on every rule without fighting the linter.
- **Everything else applies.** Every other rule — `soft-imperative`,
  `taste-word`, `trailing-etc`, `long-sentence`, the cross-file
  duplication and emphasis-inflation checks, all of it — runs
  normally on agentmd files. The dialect changes *rationale
  semantics*, not prose-quality expectations.
- **Mixed harnesses work.** One lint run can have plain-prose mode
  files alongside agentmd-authored agents; each file is judged by the
  dialect it's actually in.
- **Generated outputs are skipped** (with `.gitignore` honored by
  default). If you author with agentmd and compile to
  `AGENTS.md` + `.cursor/rules/` + `.opencode/agents/`, only the
  source file is linted — not the N generated copies. That keeps
  findings in the file you actually edit.

If you're using agentmd and the linter *is* flagging your `why:`
paragraphs, the most likely cause is that the H1 isn't
`# Agent: <name>` (the detector looks for that exact shape). Rename
the H1 and isolint will recognise the dialect on the next run.

### Plan files

For JSON `Plan` files, use `isolint validate --perf` instead of the markdown
linter. That path runs plan-specific performance checks such as:

- repeated or restated steps
- instructions that duplicate `expected_output`
- schema details repeated in prose
- structured outputs that also ask for explanation
- tone/style guidance on structured outputs
- long low-signal step instructions

`isolint plan` uses the same checks during generation. If the model emits a
schema-valid plan with plan-performance findings, the planner retries with
the formatted findings as repair feedback until the plan is clean or it runs
out of attempts.

### Skip spans

Rules never fire inside these spans:

| Span | Default | Why |
| --- | --- | --- |
| Fenced code blocks | on | Example input/output, not prose |
| Inline code (`` `word` ``) | on | The word is being named |
| HTML comments | on | Author notes |
| Short double-quoted phrases (≤ 40 chars) | on | `Avoid "leveraged", "cutting-edge"` — words being named, not used. Full-sentence quoted directives (>40 chars) still lint. |
| YAML/TOML frontmatter | on | Opencode modes, Claude Code agents, Cursor `.mdc` rules — structured metadata, not prose instructions |
| `>` blockquotes | on | Usually example input/output or quoted prose, not harness instructions |

`soft-imperative` additionally skips findings inside questions (sentence
ending in `?`) — `What story should they tell?` is not an instruction.

Disable any span via `skip_spans` in config.

### Section-aware severity

Every finding is tagged with its enclosing `## Heading`. You can mute or
downgrade rules inside specific sections:

```json
{
  "section_severity": {
    "Examples": "off",
    "Notes": "info",
    "Changelog": "off"
  }
}
```

Keys are case-insensitive. Useful for docs-heavy harness files where
`## Examples` contains intentional bad prose. The text reporter groups
findings by section so CI logs stay navigable.

### Sentence context

Every finding carries its containing sentence — the tokenizer correctly
handles abbreviations, filenames, decimals, URLs, and ellipses. This
powers three things:

1. **Text reports** show `in: "<sentence>"` so you can act without opening
   the file.
2. **`--fix --llm`** coalesces multiple findings in the same sentence into
   one rewrite — no more conflicting edits.
3. **JSON/SARIF** expose `sentence` and `section` fields so downstream
   tools (Claude Code, review bots) have the full context.

### Cross-file awareness

Three rules look beyond a single line or file:

- `undefined-step-reference` aggregates every `## Step N` / `## Block X`
  heading across every file in the lint set. A reference is flagged only if
  it isn't defined *anywhere* in the scanned harness. Multi-file harnesses
  that keep shared Blocks in `_shared.md` work out of the box.
- `missing-file-reference` reads the repo file list and flags any
  filename in prose (`cv.md`, `profile.json`, `schema.yaml`) that doesn't
  exist. Basename-matched, so references to `cv.md` from `modes/apply.md`
  resolve against `data/candidates/cv.md`.
- `context-budget` counts prose words (excluding code fences and
  frontmatter) per harness file. Override thresholds via
  `"context-budget.info_words"` / `"context-budget.warn_words"`.

### `isolint verify` — real-model empirical bridge

The simulator is deterministic. To see how the rewrites move the needle
on your *actual* target model, use `verify`:

```bash
npx @razroo/isolint verify \
  --harness modes/classify.md \
  --input tests/sample.json \
  --small mistralai/mistral-7b-instruct \
  --large anthropic/claude-3.5-sonnet
```

`verify` runs the original harness through the small model, applies
`--fix --llm` rewrites via the large model, runs the fixed harness through
the small model again, and reports: simulator fragility before/after,
harness size before/after (chars, words, approximate prompt tokens,
sentences, performance findings), char-delta in output, JSON-validity
before/after, and the raw model outputs for side-by-side inspection.
First time the "small models don't break" claim can be validated
empirically on the actual target.

### Proof the fixes work

The tagline is "rewrites harnesses so small models don't break." A
simulator codifies known 7B-class failure modes (drops `should`, invents
items past `etc.`, skips `when relevant` conditionals, loses the middle
of long sentences, hallucinates dangling `$input.X` refs) and produces a
**fragility score** — the fraction of instructions a weak model would
break on.

The regression-sim test suite asserts that for every fixture, running
`isolint --fix` **strictly decreases** the fragility score. Measured on
the built-in fixtures:

| Fixture       | Before fix       | After fix        |
| ---           | ---              | ---              |
| `classify`    | 0.75 (3 fail / 1 follow) | 0.00 (0 fail / 4 follow) |
| `multi-step`  | 0.75 (3 fail / 1 follow) | 0.25 (1 fail / 3 follow) |

CI fails if a rule change regresses either fixture. For the first time,
the "so small models don't break" claim is a number, not an assertion.

### Validated rewrites

Every LLM rewrite is re-linted before being applied. A rewrite is accepted
only if:

1. The rule that triggered the fix no longer fires on the new text.
2. No *new* rules fire on the new text.
3. Markdown structure is preserved (heading, list, code-fence, inline-code,
   bold, and link counts all match).

If a rewrite fails validation, the linter retries once with explicit
feedback about what went wrong. If the retry also fails, the fix is
skipped and reported in the fix summary — no mangled prose ever lands
on disk. This is what makes `--fix --llm` safe to run in CI.

Three mechanisms work together to improve rewrite quality:

- **Few-shot examples per rule** — each rule ships canonical `bad → good`
  pairs that are included in the prompt when that rule fires. Grounds the
  model in the intended fix direction instead of hoping it guesses. Every
  example is also a self-test: CI asserts that `bad` triggers the rule and
  `good` doesn't.
- **Self-consistency sampling** — 3 candidates are generated in parallel
  per attempt; the validator scores each; the lowest-problem candidate
  wins. Tunable via `samples_per_attempt` (default 3; set to 1 to disable).
- **Feedback-driven retry** — a rejected rewrite is fed back to the model
  with its specific validation problems ("rewrite still violates X";
  "markdown structure changed"). The retry is targeted, not a cold reroll.

### Rewrite stats

`isolint lint --fix --llm --stats` prints a per-rule table of rewrite
outcomes — candidates, first-try accepts, accepts after retry, rejects,
and an overall accept percentage. Low accept rates are a signal that the
rule's examples or message need work.

### Real-world result

Run against JobForge's `modes/` directory (19 files, 1900+ lines of
opencode harness prose):

```
$ npx @razroo/isolint lint /Users/you/JobForge/modes
...
19 files scanned — 54 warnings, 6 infos
```

Every finding points at a concrete phrase that a 7B model will handle
worse than a Claude-class model. `--fix --llm` rewrites each one
while preserving intent and markdown formatting.

### Offline demo (no API key)

```bash
npx tsx examples/lint-demo/run.ts
```

Runs lint + fix end-to-end against a sample file with a mock rewriter.

---

## Plans (the compiler mode)

### The Plan format

A `Plan` is a pure data object (see `src/schema/plan.ts`):

- `input_schema` — JSON Schema for the user input.
- `steps[]` — ordered, atomic steps. Each step has:
  - `instruction` — a single imperative task.
  - `inputs` — explicit references: `$input` or `$steps.<id>`.
  - `constraints` — machine-checkable rules (length, regex, enum).
  - `expected_output` — `text`, `enum`, `json`+schema, or `list`.
  - `failure_handling` — `retry` | `repair` | `fallback` | `fail`.
- `final_output` — which step (or composition of steps) is the result.

Every plan is validated against `src/schema/plan.ts` before execution.
Every step output is validated against its `expected_output`.
Nothing is trusted.

### The Runtime

For each step, the runtime:

1. Resolves `inputs` (`$input`, prior step outputs).
2. Builds a minimal prompt — instruction, labeled inputs, constraints,
   explicit output format. No persona preamble, no hidden reasoning.
3. Calls the small model.
4. Validates the output:
   - Output kind (text/enum/json/list) + schema.
   - Constraints (`must_match` / `must_not_match` regex).
5. On failure, follows the step's `failure_handling`:
   - `retry` — same prompt.
   - `repair` — append validator errors, ask for a fix.
   - `fallback` — return a deterministic value.
   - `fail` — abort the plan.

## Install

If you just want the CLI, run it directly with `npx`:

```bash
npx @razroo/isolint lint ./modes
```

Or add it to a project:

```bash
npm install -D @razroo/isolint
```

If you're developing this repo itself:

```bash
npm install
npm run build
```

Requires Node ≥ 18.17.

## Configure

Copy the checked-in example env file if you want local defaults:

```bash
cp .env.example .env
```

Preferred env vars:

```bash
OPENROUTER_API_KEY=sk-or-...
ISOLINT_LARGE=anthropic/claude-3.5-sonnet
ISOLINT_SMALL=mistralai/mistral-7b-instruct
```

Legacy `ISOMODEL_LARGE` / `ISOMODEL_SMALL` are still accepted for
compatibility.

Force provider selection with `--provider openrouter|openai|ollama|custom`.
OpenRouter and OpenAI work out of the box. Groq, Together, vLLM, and other
OpenAI-compatible endpoints work via `--provider custom --base-url`.

## CLI

`lint` and `verify` are covered above because they are the main linter
workflows. The commands below are for the plan/runtime pipeline.

### `isolint plan`

Ask the large model to generate a Plan for a new task.

```bash
npx @razroo/isolint plan \
  --task "Extract purchase orders from emails into {po_number, vendor, total}" \
  --out plans/po-extract.json
```

After writing the file, `plan` also runs the advisory plan-performance
checks and prints any overhead findings immediately.

### `isolint run`

Run an existing Plan through the small model.

```bash
npx @razroo/isolint run \
  --plan examples/multi-step-reasoning/plan.json \
  --input examples/multi-step-reasoning/input.json
```

Pipe stdin:

```bash
cat ticket.json | npx @razroo/isolint run --plan plan.json --input -
```

### `isolint validate`

Schema-check a plan without running it.

```bash
npx @razroo/isolint validate --plan examples/cold-email/plan.json
```

Run the schema check plus advisory performance analysis:

```bash
npx @razroo/isolint validate \
  --plan examples/cold-email/plan.json \
  --perf
```

CI / local gate for bundled examples:

```bash
npm run check:plans
```

## Examples

Three ready-to-run plans live in `examples/`:

| Example                   | What it shows                                                   |
| ------------------------- | --------------------------------------------------------------- |
| `cold-email/`             | Structured paragraphs with regex constraints (subject/hook/value/ask) |
| `data-extraction/`        | Strict-schema JSON extraction + numeric computation over prior steps |
| `multi-step-reasoning/`   | Support-ticket triage: classify → severity → root cause → next action |

### Offline demo (no API key)

```bash
npx tsx examples/offline-demo/run.ts
```

Runs the `multi-step-reasoning` plan end-to-end against a mock small model.
Proves the full loop: input validation → per-step execution → schema
validation → final output composition.

### Real run

```bash
npx @razroo/isolint run \
  --plan examples/data-extraction/plan.json \
  --input examples/data-extraction/input.json \
  --small mistralai/mistral-7b-instruct
```

## Programmatic API

```ts
import { Planner, Runtime, createProvider } from "@razroo/isolint";

const plan = await new Planner(
  createProvider({ model: "anthropic/claude-3.5-sonnet" }),
).generate({ task: "Classify tickets and propose a next action" });

const result = await new Runtime(
  createProvider({ model: "mistralai/mistral-7b-instruct" }),
).run(plan.plan, { ticket: { subject: "...", body: "..." } });

console.log(result.final);
```

## Design constraints (enforced)

<!-- isolint-disable -->

- **No long runtime prompts.** All complexity lives in the Plan.
- **No vague instructions.** The planner system prompt forbids
  "be creative", "engaging", "appropriate", etc.
- **No world-knowledge dependence.** Every step must cite `$input`
  or a prior step as its fact source.
- **No taste-based validation.** Constraints must be regex, length,
  enum, or schema.
- **Deterministic by default.** Runtime temperature defaults to `0`.

<!-- isolint-enable -->

## Tests

```bash
npm test
```

The suite covers lint rules, suppressions, fix engine, diff output, schema
validation, JSON extraction, runtime retry/repair, fallback handling, and
input-schema enforcement.

## License

MIT

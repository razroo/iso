<p align="left">
  <img src="assets/logo.svg" alt="agentmd" width="300">
</p>

# agentmd

A structured-markdown format and CLI for writing LLM agent prompts — with a
linter that checks what actually matters, and a fixture-driven adherence
tester that runs each prompt through a small model and reports whether the
agent followed the rules.

Two ideas, both of which the usual "prompt DSL" approach gets wrong:

1. **Lint structure, not words.** Flagging "good", "nice", "appropriate" is
   cargo-cult. The real bugs in agent prompts are missing rationale,
   dangling cross-references, duplicate IDs, multi-action procedure steps,
   routing tables with no fallback branch. Those are what this linter
   catches.
2. **Measure adherence.** A prompt is only good if the model follows it.
   `agentmd test` ships fixture cases through the compiled prompt and reports
   per-rule pass rate — the only loop that tells you if a change made the
   prompt better or worse.

No new syntax. Markdown stays markdown. `agentmd` just adds a tight dialect
and a test harness.

## Install

```
npm install
```

Requires Node ≥ 22.

## Format

A prompt file is a regular markdown file with these conventions:

```markdown
# Agent: my-agent

One short paragraph describing what the agent does.

## Hard limits

- [H1] Rule text.
  why: the motivation — ideally a past incident
- [H2] Another rule.
  why: ...

## Defaults

- [D1] A default the agent should follow unless it has a stated reason to deviate.
  why: ...

## Procedure

1. One action per step.
2. Reference rules inline with [H1], [D1].

## Routing

| When | Do |
|------|-----|
| specific condition | specific action |
| otherwise | fallback action |

## Output format

Free-form context sections. Pass through to the prompt untouched.
```

Rule ID conventions:

- `H#` — hard limits (never violate)
- `D#` — defaults (overridable with an explicit stated reason)

Every rule needs `[ID]` and a `why:`. The why is load-bearing: when the agent
hits an edge case, the rationale is how it decides. Rules without a why are a
lint error.

## Example — a real file, end to end

Here's the full `examples/outreach-writer.md` that ships in this repo. It's
been iterated against the adherence harness until Claude Haiku 4.5 hits 8/8
on the fixture cases in `examples/fixtures/outreach-writer.yml`:

```markdown
# Agent: outreach-writer

Cold outbound email writer for B2B sales. Given a prospect profile and optional
company context, produce a short, specific email that earns a reply.

## Hard limits

- [H1] Produce at most 140 words in the email body.
  why: emails over 140 words have under 2% reply rate in our historical data
- [H2] Never fabricate metrics, customer names, or company facts.
  why: 2025-11 incident — fabricated ARR figure in outbound email, lost the deal
- [H3] Do not use placeholder tokens like [Company] or {name} in the output.
  why: placeholders leak when the copy is pasted straight into a send tool

## Defaults

- [D1] When company_context is provided, name the prospect's company in the first sentence and reference one specific fact from that context. Without company_context, open with a concrete observation about the prospect's role or seniority.
  why: naming the company signals the email was written for them; ESPs flag generic openers ("Hope you're well") as spam
- [D2] End with exactly one direct ask: propose a 15-minute call with two specific time windows (e.g., "Tuesday 10am or Thursday 2pm ET?"). Do not hedge ("Worth grabbing…?", "Would you be open…?"). Do not add a second open question after the ask.
  why: hedged phrasing reads as unsure; multiple asks dilute intent and reply rate drops
- [D3] Write in four short paragraphs, one idea per paragraph.
  why: small screens and quick skims — paragraphs over 3 lines get skipped

## Procedure

1. Read the prospect profile; identify role, seniority, likely priorities.
2. Pick one specific observation about the prospect's company.
3. If no company context is given, pick a concrete observation about the role instead.
4. Draft the email following [D1], [D2], [D3].
5. Self-check against [H1], [H2], [H3], [D1], [D2]; revise if any fail.

## Routing

| When | Do |
|------|-----|
| Prospect is IC engineer | Lead with a technical observation |
| Prospect is director or VP | Lead with a business-outcome framing |
| No company_context provided | Use only role-level framing; do not invent company facts |
| otherwise | Default to role-level framing |

## Output format

Return just the email body. No subject line, no signature block, no preamble
like "Here is the email:". Plain text, no markdown.
```

### Compiled form

Running `agentmd render` on that file is lightweight: it adds explicit scope
labels to the `## Hard limits` and `## Defaults` headings so the model knows
which rules are non-negotiable, and normalises whitespace. Everything else —
rule IDs, `why:` lines, the procedure's `[H1]` cross-references, the
routing table — passes through verbatim.

The total diff is two lines:

```diff
- ## Hard limits
+ ## Hard limits — must never be violated

- ## Defaults
+ ## Defaults — may be overridden only with an explicit stated reason
```

<details>
<summary>Full compiled output (what the model actually sees)</summary>

```markdown
# Agent: outreach-writer

Cold outbound email writer for B2B sales. Given a prospect profile and optional
company context, produce a short, specific email that earns a reply.

## Hard limits — must never be violated

- [H1] Produce at most 140 words in the email body.
  why: emails over 140 words have under 2% reply rate in our historical data
- [H2] Never fabricate metrics, customer names, or company facts.
  why: 2025-11 incident — fabricated ARR figure in outbound email, lost the deal
- [H3] Do not use placeholder tokens like [Company] or {name} in the output.
  why: placeholders leak when the copy is pasted straight into a send tool

## Defaults — may be overridden only with an explicit stated reason

- [D1] When company_context is provided, name the prospect's company in the first sentence and reference one specific fact from that context. Without company_context, open with a concrete observation about the prospect's role or seniority.
  why: naming the company signals the email was written for them; ESPs flag generic openers ("Hope you're well") as spam
- [D2] End with exactly one direct ask: propose a 15-minute call with two specific time windows (e.g., "Tuesday 10am or Thursday 2pm ET?"). Do not hedge ("Worth grabbing…?", "Would you be open…?"). Do not add a second open question after the ask.
  why: hedged phrasing reads as unsure; multiple asks dilute intent and reply rate drops
- [D3] Write in four short paragraphs, one idea per paragraph.
  why: small screens and quick skims — paragraphs over 3 lines get skipped

## Procedure

1. Read the prospect profile; identify role, seniority, likely priorities.
2. Pick one specific observation about the prospect's company.
3. If no company context is given, pick a concrete observation about the role instead.
4. Draft the email following [D1], [D2], [D3].
5. Self-check against [H1], [H2], [H3], [D1], [D2]; revise if any fail.

## Routing

| When | Do |
|------|-----|
| Prospect is IC engineer | Lead with a technical observation |
| Prospect is director or VP | Lead with a business-outcome framing |
| No company_context provided | Use only role-level framing; do not invent company facts |
| otherwise | Default to role-level framing |

## Output format

Return just the email body. No subject line, no signature block, no preamble
like "Here is the email:". Plain text, no markdown.
```

</details>

The "compile" step exists to make the scope semantics explicit to the model
(which rules are non-negotiable vs. overridable) and to give the linter and
test runner a parsed AST to work from. Nothing else gets rewritten — the
`why:` lines are preserved on purpose because the model uses them to judge
edge cases.

### Sample output

A representative output Haiku produced during the last adherence run
(input: senior backend engineer at Acme, Go + Kubernetes, company context
about 200+ microservices on GKE and recent layoffs):

```
At Acme, managing 200+ microservices on GKE means your team is likely
bottlenecked on deployment velocity or debugging cross-service issues—I
work with senior engineers at scale who tell us these are the top
constraints.

With recent headcount changes, that pressure probably got tighter. We help
teams ship faster and automate infrastructure work so you do more with
less.

We built this specifically for Go services in Kubernetes. Happy to walk
through how it works for your setup.

Could we grab 15 minutes Tuesday 2pm or Thursday 10am ET?
```

Naming Acme and citing a specific fact satisfies `[D1]`; closing with one
direct two-window ask satisfies `[D2]`; 88 words stays under `[H1]`; no
fabricated numbers satisfies `[H2]`. The full report the harness produces
is further down under [Report](#report).

### The iteration loop this unlocks

The reason to write prompts this way isn't the syntax — it's that rule
changes produce a measurable number. An earlier version of this file had:

```markdown
- [D1] Open with a specific observation about the prospect's company or role.
- [D2] Close with one concrete next step (a 15-min call or a link).
```

Against the fixtures, that scored 6/8 (75%): `[D1]` 0/1 (no company name),
`[D2]` 1/2 (one case closed with a hedged "Worth grabbing…?"). Tightening
`[D1]` to "name the company in the first sentence when context is
provided" and `[D2]` to "exactly one direct ask with two specific time
windows" — plus adding `[D1]` and `[D2]` to the self-check in step 4 —
moved the score to 8/8 (100%) in one rerun. Without the harness you'd be
guessing whether the changes helped.

## CLI

```
agentmd new <name> [--dir <path>]
agentmd lint <file> [--watch]
agentmd render <file> [--out <path>]
agentmd test <file> --fixtures <path>
                    [--via <api|claude-code>] [--model <id>]
                    [--temperature <n>] [--concurrency <n>] [--trials <n>]
                    [--rule <ID>] [--fail-under <pct>]
                    [--format <text|json>] [--out <path>]
                    [--baseline <path>] [--list]
                    [--verbose] [--watch]
agentmd diff <old.md> <new.md>
agentmd history <report.json>...
```

- `new` — scaffold `<name>.md` + `fixtures/<name>.yml` as a starting point.
- `lint` — structural checks (see below). Exits non-zero on errors.
- `render` — emit the compiled prompt (what the model sees). `render` adds
  explicit "must never be violated" / "may be overridden…" scope labels.
- `test` — run fixture cases through the compiled prompt and report per-rule
  adherence.
- `diff` — structural diff of rule sets between two prompt files (added,
  removed, scope-changed, claim-changed, why-changed). Useful in PR review
  when a teammate changes an agent's rules.
- `history` — takes multiple JSON reports (shell-globbed, e.g.
  `reports/*.json`), sorts them by timestamp, and prints per-rule adherence
  over time with a net delta.

Add `--watch` to `lint` or `test` to re-run on file changes.

Determinism: `--temperature` defaults to 0 for `--via api` so adherence
numbers don't drift between runs. `--via claude-code` ignores the flag
because `claude -p` has no such option — for repeatable measurement, use
the api backend. `--concurrency N` runs up to N fixture cases in parallel
(default 1).

Iteration loop flags:

- `--trials N` runs each case N times and reports pass rate per case
  (`[D2] 3/5`). Main use case is the `claude-code` backend, where the
  model's non-zero temperature makes single runs noisy. With `--via api`
  at the default `--temperature 0`, trials > 1 just costs tokens.
- `--rule <ID>` filters fixtures to expectations for a single rule. Cases
  left with zero expectations are skipped. Use when iterating on one rule
  to shave round-trips.
- `--fail-under <pct>` exits non-zero if overall adherence drops below
  the given percentage. Pairs with CI without needing a baseline file.
- `--list` parses the agent file and fixtures and prints the test plan
  without calling the model. Cheap smoke test while authoring.

Baselines: write a JSON report with `--format json --out baseline.json`,
then on a later run pass `--baseline baseline.json`. The diff compares
per-rule adherence and exits non-zero if any rule regressed. Keep those
JSON files in `reports/` and `agentmd history reports/*.json` gives you
a trend line per rule across runs.

Environment: `ANTHROPIC_API_KEY` is read from the environment or from a
`.env` file in the working directory. Explicit exports win over `.env`.

### Test backends

`--via api` (default): calls the Anthropic SDK. Requires `ANTHROPIC_API_KEY`.

`--via claude-code`: shells out to `claude -p` on PATH. Uses your Claude Code
login, so no API key needed. The runner passes:

- `--system-prompt <rendered>` (overrides the default system prompt)
- `--tools ""` (no tool use — pure LLM one-shot)
- `--no-session-persistence` (doesn't pollute session history)
- spawns with `cwd = os.tmpdir()` so the project's `CLAUDE.md` is not
  auto-discovered and leaked into the test

Caveat: a user-level `~/.claude/CLAUDE.md` may still load. If that matters,
use `--via api`.

## Works with isolint

agentmd checks **structure** — rule IDs, cross-references, fallback rows,
scope labels. [isolint](https://github.com/razroo/isolint) checks **prose** —
phrases weak small models can't reliably parse (`should`, `when relevant`,
`one of the usual categories`), unclosed `etc.` lists, overlong sentences,
taste words. The two look at different failure modes and compose naturally:
agentmd won't tell you a rule claim is mushy; isolint won't tell you there's
a dangling `[D4]` reference.

The recommended pipeline — structure first, prose second, adherence last:

```
agentmd lint agent.md                            # structural bugs
agentmd render agent.md --out compiled.md
isolint lint compiled.md                         # prose bugs
agentmd test agent.md --fixtures fixtures.yml    # measured adherence
```

Load-bearing interop: isolint recognises agentmd-dialect files (by the
`# Agent: <name>` H1) and deliberately skips its
`perf-rationale-in-shared-prefix` rule on them — agentmd treats `why:` lines
as context the model uses to judge edge cases, and stripping them would
defeat that.

Run both in CI via `npm run ci` (`lint:isolint` no-ops gracefully if isolint
isn't on `PATH`).

## Lint rules

| Code | Severity | What it checks |
|------|----------|----------------|
| L1 | error | Every rule has an `[ID]` |
| L2 | error | Every hard-limit/default has a `why:` line |
| L3 | error | Rule IDs are unique |
| L4 | error | `[ID]` references in prose resolve to a defined rule |
| L5 | warning | H-ids live in Hard limits, D-ids in Defaults |
| L6 | warning | Procedure steps do one thing (no `" and "` / `" or "`) |
| L7 | warning | Procedure steps stay short (≤ ~15 words) |
| L8 | warning | Routing tables include a fallback row |
| L9 | error/warning | Required sections present (Agent heading, Procedure, at least one rule) |
| L10 | warning | Every defined rule is referenced somewhere in Procedure or Routing |
| L11 | warning | `why:` has at least ~5 words — rationale thinner than that can't guide edge cases |

Deliberately **not** checked: vague-word heuristics. They produce false
positives on real prose and miss the actual bugs.

## Fixtures

```yaml
agent: outreach-writer
cases:
  - name: ic-engineer-prospect
    input:
      prospect_profile: "Senior backend engineer at Acme, Go + Kubernetes"
      company_context: "Acme runs 200 microservices, recent layoffs"
    expectations:
      - rule: H1
        check: word_count_le
        value: 140
      - rule: H2
        check: does_not_contain
        value: ["$", "%"]
      - rule: D1
        check: llm_judge
        prompt: "Does the email open with a specific observation about Acme?"
```

The input is passed verbatim to the agent as the user message (strings) or
serialised as YAML (objects). Each expectation ties a rule ID to a check.

### Check types

| check | value | meaning |
|-------|-------|---------|
| `word_count_le` | number | output has at most N words |
| `word_count_ge` | number | output has at least N words |
| `char_count_le` | number | output has at most N characters |
| `does_not_contain` | string or list | none of the substrings appear (case-insensitive). Set `mode: regex` to match patterns instead |
| `contains_all` | string or list | all substrings appear (case-insensitive). Set `mode: regex` to match patterns instead |
| `regex` | string | pattern matches somewhere in the output |
| `llm_judge` | (uses `prompt:`) | a small model answers yes/no against your question |

`llm_judge` is the escape hatch for things that only a model can evaluate
("does the opener reference the prospect's company?"). Keep the judge prompt
narrow and binary.

`examples/fixtures/minimal.yml` exercises every check type in one file and is
a good starting template.

**Convention: `yes` must always mean the rule was followed.** Phrase the
judge question positively: *"Does the email avoid fabricating metrics?"*
rather than *"Does the email fabricate metrics?"* — otherwise `passed=true`
will fire on rule violations.

## Report

```
agent: outreach-writer

case: ic-engineer-with-context
  [H1] word_count_le       PASS  127 words (limit 140)
  [H3] does_not_contain    PASS  none of 5 forbidden substrings present
  [D1] llm_judge           PASS  judge: yes
  [D2] llm_judge           FAIL  judge: no

...

adherence by rule:
  [D1] 2/2 (100%)
  [D2] 1/2 (50%)  ← attention
  [H1] 2/2 (100%)
  [H3] 2/2 (100%)

overall: 7/8 (88%)
```

Rule-grouped output tells you which rule the agent is missing — which is the
thing you can actually go fix.

## Dev

```
npm test          # node:test suites for parser, linter, checks, runner, fixtures
npm run typecheck # tsc --noEmit
npm run ci        # typecheck + test + lint:examples + optional isolint pass
```

The runner takes an `AgentFn` and optional `JudgeFn` by injection, so tests
run fully offline against a fake agent. The Anthropic client is isolated to
`src/anthropic.ts`.

## Layout

```
src/
  types.ts          AST shapes
  parser.ts         markdown → AST
  render.ts         AST → compiled prompt
  linter.ts         structural checks (L1–L9)
  checks.ts         check functions
  fixtures.ts       YAML loader
  runner.ts         wires prompt + fixtures + agent
  anthropic.ts      Claude client (AgentFn + JudgeFn via SDK)
  claude-code.ts    Claude client (AgentFn + JudgeFn via `claude -p` subprocess)
  report.ts         format per-rule adherence
  cli.ts            command dispatcher

examples/
  outreach-writer.md
  fixtures/outreach-writer.yml

tests/              node:test suites
bin/agentmd         tsx entry shim
assets/
  logo.svg          wordmark
  mark.svg          square mark (avatar / social image)
```

## Brand

- Primary: teal `#0F766E` (the bracketed `[md]` in the wordmark, and the
  background of the square mark)
- Secondary: slate `#374151` (the "agent" portion of the wordmark)
- Motif: `[md]` rendered in the same bracket shape used for rule IDs
  (`[H1]`, `[D1]`) — the brackets are the format's signature.

# Integrations

This repo ships seven packages that **work on their own** but are **designed
to compose**. Some of the useful compositions are already wired up; others
are still open and deliberately documented here so an AI coding agent (or a
human) can pick one up without guessing at intent.

Each entry below is actionable:

- **Target end-state** — the observable behavior when it's done.
- **Touch** — the files that need to change.
- **Verify** — how a test proves it works.

Treat this as a backlog. If you implement one, delete that section (or
mark it done) in the same PR, and add an entry to `examples/pipeline/` or
a dedicated example if it's user-visible.

Rules of the road:

- **Don't design for hypothetical integrations.** If a composition isn't
  listed here, it isn't planned — ask before building.
- **Keep packages standalone.** Integrations are additive: a consumer of
  `iso-harness` who never installs `iso-route` should keep working
  unchanged.
- **Prefer on-disk contracts over in-process imports.** The packages are
  published and versioned independently; coupling through a JSON file in
  the output directory is safer than coupling through TypeScript types.

---

## 1. `iso-harness` ← consumes `iso-route` resolved role map

**Status:** open. `iso-route` already writes
`<out>/.claude/iso-route.resolved.json` when emitting for Claude; nothing
reads it yet.

**Target end-state.** When `iso-harness build` runs and finds
`.claude/iso-route.resolved.json` in its `--out` directory, it stamps a
`model:` field in each Claude subagent's frontmatter using the matching
role's resolved model. If the role is absent from the map, or its
provider is non-anthropic, the subagent emits without `model:` and
iso-harness logs one line per skip.

**Touch.**

- `packages/iso-harness/src/targets/claude.mjs` — before writing
  `.claude/agents/<name>.md`, read the resolved map once if it exists and
  look up `roles[agentName]`.
- `packages/iso-harness/src/frontmatter.mjs` — add a `model` field to
  the frontmatter emitter if the value is non-null.
- `packages/iso-harness/README.md` — add a paragraph under "Composition"
  explaining the resolved-map contract.

**Verify.**

- New test under `packages/iso-harness/tests/` that writes a fake
  resolved map + an agents source, runs the build, and asserts the
  emitted subagent file contains `model: claude-opus-4-7`.
- Existing test suite still passes when no resolved map is present
  (additive change).

---

## 2. `@razroo/iso` wrapper ← composes `iso-route build` as an optional step

**Status:** open. The wrapper currently chains
`agentmd → isolint → iso-harness`. `iso-route` runs alongside, not inside.

**Target end-state.** `iso build .` detects `models.yaml` (or
`iso/models.yaml`) in the project root. If present, the pipeline inserts
an `iso-route build` step *before* `iso-harness build` so the resolved
map is on disk when iso-harness reads it (see integration #1).
`iso plan` lists the step. `--skip-iso-route` opts out.

**Touch.**

- `packages/iso/src/pipeline.mjs` — add a new `planPipeline` branch that
  appends the iso-route step conditionally on `models.yaml` existence.
- `packages/iso/package.json` — add `@razroo/iso-route` to
  `dependencies`.
- `packages/iso/bin/iso.mjs` — surface `--skip-iso-route` in the CLI
  flag parser.
- `packages/iso/README.md` — document the new step and flag.
- `examples/dogfood/` — add a sample `models.yaml` so the dogfood
  exercises the composed flow.

**Verify.**

- `npm run test:dogfood` still passes.
- New test in `packages/iso/tests/` that drives `planPipeline` against a
  fixture project with and without `models.yaml`, asserts the step list
  contains / omits `iso-route build` accordingly.

---

## 3. `iso-eval` ← `agentmd_adherence` check type

**Status:** open. `iso-eval` README already anticipates this check; no
implementation yet.

**Target end-state.** A suite task can declare:

```yaml
- id: planner-follows-h3
  prompt: …
  workspace: …
  checks:
    - type: agentmd_adherence
      prompt_file: ../agent.md
      fixtures: ../fixtures/planner.yml
      rule_id: H3
      min_pass_rate: 0.9
```

On run, iso-eval shells out to `agentmd test` (or calls its library API)
against the fixtures and fails the task when per-rule pass rate for the
named rule is under `min_pass_rate`.

**Touch.**

- `packages/iso-eval/src/types.ts` — add `AgentmdAdherenceCheck`
  interface and extend the `Check` union.
- `packages/iso-eval/src/parser.ts` — allow `agentmd_adherence` in
  `VALID_CHECK_TYPES`.
- `packages/iso-eval/src/checks/` — new `agentmd-adherence.ts` module.
- `packages/iso-eval/package.json` — add `@razroo/agentmd` to
  `dependencies` (new cross-package dep).
- `packages/iso-eval/README.md` — document the check row in the table.

**Verify.**

- Unit test under `packages/iso-eval/tests/` using a fake
  `AgentmdAdherenceFn` so the check can run offline.
- Example suite in `packages/iso-eval/examples/suites/` that exercises
  the check against an agentmd fixture.

---

## 4. `iso-trace` → `iso-eval` fixture export

**Status:** open. `iso-trace` can already export a session as JSONL or
JSON, but nothing lifts it into an `iso-eval` task fixture.

**Target end-state.** `iso-trace export-fixture <session-id> --out
fixtures/<name>/` writes:

- `fixtures/<name>/task.md` — the user prompt that kicked off the
  session, extracted from the first user turn.
- `fixtures/<name>/workspace/` — a snapshot of the files the agent
  touched during the session (use `cwd` + `file_op` events to scope).
- `fixtures/<name>/checks.yml` — a seed `file_exists` / `file_contains`
  check per file the agent created or modified.

A maintainer can then edit the emitted `checks.yml` and drop the fixture
into an `iso-eval` suite to lock in real-world behavior as a regression
test.

**Touch.**

- `packages/iso-trace/src/cli.ts` — add the `export-fixture` command.
- `packages/iso-trace/src/fixtures.ts` (new) — fixture emission logic.
- `packages/iso-trace/README.md` — document the command under "What
  iso-trace is for".
- Consider a reverse reference in `packages/iso-eval/README.md` noting
  that fixtures can be bootstrapped from iso-trace.

**Verify.**

- Test using the bundled `examples/sample-session.jsonl` — export a
  fixture and assert the emitted `task.md` / `checks.yml` shape.
- Round-trip test: feed the exported fixture into `iso-eval run` with
  the deterministic `fake` runner and confirm it passes.

---

## 5. `examples/pipeline/` ← exercise all seven packages

**Status:** open. `examples/pipeline/build.mjs` currently drives only
`agentmd → isolint → iso-harness`.

**Target end-state.** A single `npm run test:pipeline` exercises the
whole loop:

1. `agentmd lint` + `agentmd render`
2. `isolint lint` the rendered prompt
3. `iso-route build` against a sample `models.yaml`
4. `iso-harness build` (reads the resolved map from step 3)
5. `iso-eval run` against a tiny bundled suite using the `fake` runner
6. `iso-trace stats --source` on a bundled sample session

Green on the whole chain = full integration smoke.

**Touch.**

- `examples/pipeline/build.mjs` — append the three missing steps.
- `examples/pipeline/models.yaml` (new) — minimal two-role example.
- `examples/pipeline/eval/eval.yml` (new) — one task suite using the
  `fake` runner.
- `examples/pipeline/sessions/sample.jsonl` (new, or reuse
  `packages/iso-trace/examples/sample-session.jsonl`).
- Root `README.md` — update the "End-to-end example" paragraph to name
  all the packages the pipeline now exercises.

**Verify.** `npm run test:pipeline` exits 0 on a clean clone.

---

## Design questions that are *not* open integrations

The following look like integrations but are deliberately decoupled —
don't "fix" them without a conversation first.

- **`isolint` does not reach into `agentmd` file structures.** isolint
  recognises agentmd-dialect files (by the `# Agent: <name>` H1) and
  skips `perf-rationale-in-shared-prefix` on them, but it does not
  parse rule IDs or scope labels. This keeps isolint usable against any
  markdown file, not just agentmd.
- **`iso-route` does not encode fallback chains into harness config.**
  Fallback is a *runtime* concern that belongs in proxy layers
  (OpenRouter, LiteLLM, Portkey) — not in a build-time transpiler. The
  resolved map records the chain so a proxy can read it; the harness
  config only names the primary.
- **No central model catalog.** iso-route validates provider names, not
  model IDs. A shared catalog package may land later but is explicitly
  out of scope for v0.1 — typos surface at runtime, not build time.

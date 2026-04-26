# Integrations

This repo ships ten packages that **work on their own** but are **designed
to compose**. The planned cross-package compositions listed here are already
shipped, so this file now serves as:

- a ledger of the integrations that exist on purpose
- a record of the design boundaries that are still deliberate

If a new cross-package composition lands, update this file in the same PR.
If a tempting composition is *not* listed here, it is not implicitly planned.

Rules of the road:

- **Don't design for hypothetical integrations.** If a composition isn't
  listed here, it isn't planned — ask before building.
- **Keep packages standalone.** Integrations are additive: a consumer of
  `iso-harness` who never installs `iso-route` should keep working
  unchanged.
- **Prefer on-disk contracts over in-process imports.** The packages are
  published and versioned independently; coupling through a JSON file in
  the output directory is safer than coupling through TypeScript types.

At the moment there is no open integration backlog in this repo.

---

## 1. `iso-harness` ← consumes `iso-route` resolved role map — **DONE**

Shipped in `@razroo/iso-harness` 0.4.0. The Claude emitter reads
`<out>/.claude/iso-route.resolved.json` when present and stamps
`model:` onto each subagent's frontmatter using
`roles[agent.role ?? agent.slug]`. Inline `model:` in the agent source
still wins; non-Anthropic roles are skipped with a stderr warning;
missing roles are silent. See the "Composition with `@razroo/iso-route`"
section in `packages/iso-harness/README.md` for the resolution order.

---

## 2. `@razroo/iso` wrapper ← composes `iso-route build` as an optional step — **DONE**

Shipped in `@razroo/iso` 0.2.0. The wrapper detects `models.yaml` (at
project root, preferred) or `iso/models.yaml` and inserts `iso-route
build <path> --out <outDir>` before `iso-harness build`, so the
resolved role map is on disk when iso-harness reads it (see #1).
`--skip-iso-route` opts out; absent `models.yaml` skips the step
automatically. `iso plan` now lists the step and the detected
`models.yaml` path. `examples/dogfood/` carries a sample `models.yaml`
so both `npm run test:dogfood` and `npm run test:pack` exercise the
full composed flow end-to-end, asserting that `model: claude-opus-4-7`
ends up stamped on the `workspace-researcher` subagent.

---

## 3. `iso-eval` ← `agentmd_adherence` check type — **DONE**

Shipped. New `agentmd_adherence` check type scores per-rule adherence
of an agentmd prompt against a fixture file by shelling out to
`agentmd test --format json` and comparing the pass rate for the named
rule (or overall) against `minPassRate`. Tests can inject a fake
`AgentmdSpawnFn` so CI runs offline without an API key; the default
spawn resolves `@razroo/agentmd`'s CLI bin via Node module resolution
so PATH setup doesn't matter. Adds `@razroo/agentmd` as a runtime dep
so installing iso-eval pulls in the agentmd CLI. Eight new tests
cover happy-path + rule filtering + missing prompt file +
non-zero exit + invalid JSON + empty cases + unknown rule + flag
forwarding.

---

## 4. `iso-trace` → `iso-eval` fixture export — **DONE**

Shipped and expanded. `iso-trace export-fixture <id-or-prefix> --out
<dir>` (or `--source <path>` for a single JSONL) lifts a session into
an iso-eval-compatible directory: `task.md` (first user message),
`workspace/` (empty placeholders for every file the agent read), and
`checks.yml` (one `file_exists` per write plus either placeholder or
exists-only edit checks). The command now also accepts `--runner`,
`--harness-source`, `--edit-checks exists-only`, `--redact`,
`--redact-regex`, and `--run`, so a captured trace can turn into a
rerunnable Codex / Claude Code / OpenCode suite with one command.
Exposed as `exportFixture(...)` in the library API for callers that
want to skip the CLI. Tests cover message extraction, workspace
seeding, check emission, absolute-path fallthrough, no-op sessions,
missing user messages, redaction, and directory layout stability.

---

## 5. `examples/pipeline/` ← exercise the shipped build/feedback toolchain end-to-end — **DONE**

Shipped and expanded. `examples/pipeline/build.mjs` now drives the full
chain (`agentmd lint + render → isolint lint → iso-route build
--verify-models → iso-harness build → iso-eval run → iso-trace stats →
iso-trace export-fixture`) in one invocation. Bundled assets:
`examples/pipeline/models.yaml` extends the `standard` preset with a
`researcher` role, `examples/pipeline/eval/` ships a one-task suite
that the fake runner passes offline, and iso-trace runs against
`packages/iso-trace/examples/sample-session.jsonl`. The assertion set
includes the cross-package contract from #1 + #2 — the emitted Claude
subagent file must contain `model: claude-opus-4-7` driven from the
resolved role map — plus fixture export output from the trace loop.

---

## 6. `iso-guard` ← consumes `iso-trace export` JSON/JSONL — **DONE**

Introduced with `@razroo/iso-guard`'s initial release. The guard package
accepts either small normalized event arrays or `iso-trace export
<session> --format json|jsonl` output, flattens those events, and
evaluates deterministic runtime policy rules (`max-per-group`,
`require-before`, `require-after`, `forbid-text`, `no-overlap`). This
keeps enforcement outside the prompt/MCP surface while still letting a
project audit real agent behavior after a run.

---

## 7. `iso-ledger` ← durable domain event source for runtime packages — **DONE**

Introduced as a standalone package. `iso-ledger` does not import
`iso-orchestrator`, `iso-trace`, or `iso-guard`; it provides the small
on-disk contract those packages and domain tools can share:
append-only JSONL events with deterministic ids, idempotency keys,
query/has preflight checks, verification, and materialized entity views.
JobForge can layer a domain adapter over this later without making the
core ledger package know about trackers, markdown day files, or TSV
merge rules.

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
- **Cursor feedback is shipped, but Cursor `model-score` is still
  intentionally out of scope.** `iso-eval` now ships a packaged Cursor
  runner and `iso-trace` parses local Cursor transcripts / exports
  fixtures from them. `iso-trace model-score` still excludes Cursor
  because current local transcripts do not expose stable model IDs or
  tool-result metadata, so scorecards would imply more certainty than
  the source data supports.
- **No implicit build-time model validation.** `iso-route verify` and
  `build --verify-models` exist, but the default `build` path still
  validates provider names, not model IDs. Asking a live catalog is an
  opt-in check, not part of the baseline transpile step.
- **`iso-guard` is not an MCP server.** It is a CLI/library that reads
  event files and emits compact pass/fail output. If a domain package
  wants in-loop preflight, it should call the CLI and feed only the
  concise result back to the agent, not load the whole policy into the
  prompt prefix.

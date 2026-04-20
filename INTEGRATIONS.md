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

Shipped. `iso-trace export-fixture <id-or-prefix> --out <dir>` (or
`--source <path>` for a single JSONL) lifts a session into an
iso-eval-compatible directory: `task.md` (first user message),
`workspace/` (empty placeholders for every file the agent read), and
`checks.yml` (one `file_exists` per write, `file_exists` +
`file_contains` with a `REPLACE_ME` placeholder per edit). Seven new
tests cover message extraction, workspace seeding, check emission,
absolute-path fallthrough, no-op sessions, missing user messages, and
directory layout stability. Exposed as `exportFixture(...)` in the
library API for callers that want to skip the CLI.

---

## 5. `examples/pipeline/` ← exercise all seven packages — **DONE**

Shipped. `examples/pipeline/build.mjs` now drives the full chain
(`agentmd lint + render → isolint lint → iso-route build →
iso-harness build → iso-eval run → iso-trace stats`) in one invocation.
Bundled assets: `examples/pipeline/models.yaml` extends the `standard`
preset with a `researcher` role, `examples/pipeline/eval/` ships a
one-task suite that the fake runner passes offline, and iso-trace runs
against `packages/iso-trace/examples/sample-session.jsonl`. The
assertion set includes the cross-package contract from #1 + #2 — the
emitted Claude subagent file must contain
`model: claude-opus-4-7` driven from the resolved role map.
`npm run test:pipeline` exits 0 and reports 14 harness files produced.

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

# Integrations

This repo ships twenty-three packages that **work on their own** but are **designed
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

## 8. `iso-contract` ← deterministic artifact shape for domain packages — **DONE**

Introduced as a standalone package. `iso-contract` does not import
JobForge or any other domain package; it provides the on-disk JSON
contract catalog format and parser/renderer that domain packages can
share. JobForge-style examples cover tracker rows and apply outcomes,
but the package remains generic: validate records, parse delimited or
markdown-table rows, and render contract-conformant artifacts without
asking the model to remember exact column order.

---

## 9. `iso-capabilities` ← deterministic role capability policy for domain packages — **DONE**

Introduced as a standalone package. `iso-capabilities` does not import
JobForge, `iso-harness`, or any other domain package; it provides the
on-disk JSON role catalog format and checker that domain packages can
share. JobForge-style examples cover orchestrator, applicant, and
verifier roles, but the package remains generic: resolve inheritance,
check tool/MCP/command/filesystem/network requests, and render compact
target guidance without asking the model to remember a permission matrix.

---

## 10. `iso-context` ← deterministic context selection for domain packages — **DONE**

Introduced as a standalone package. `iso-context` does not import
JobForge, `iso-harness`, or any other domain package; it provides the
on-disk JSON context bundle format and budget checker that domain
packages can share. JobForge-style examples cover base/apply/tracker
mode bundles, but the package remains generic: resolve inheritance,
read declared files, estimate tokens, check per-file and per-bundle
budgets, and render markdown/json context packs without asking the model
to remember which reference files to load.

---

## 11. `iso-cache` ← deterministic artifact reuse for domain packages — **DONE**

Introduced as a standalone package. `iso-cache` does not import
JobForge, `iso-context`, `iso-ledger`, or any other domain package; it
provides the on-disk content-addressed cache contract that domain tools
can share. JobForge-style use cases include JD snapshots, portal scan
responses, rendered context bundles, and evaluation input captures, but
the package remains generic: stable key generation, TTL-aware
put/get/has/list, integrity verification, and expired/orphan pruning
without asking the model to refetch or rederive safe artifacts.

---

## 12. `iso-index` ← deterministic artifact lookup for domain packages — **DONE**

Introduced as a standalone package. `iso-index` does not import JobForge,
`iso-cache`, `iso-ledger`, `iso-contract`, or any other domain package; it
provides the on-disk JSON index format and extractor rules that domain
tools can share. JobForge-style examples cover report URLs/scores,
tracker markdown tables, scan-history TSVs, and ledger JSONL records, but
the package remains generic: build compact lookup records from configured
text, TSV, markdown-table, and JSONL sources, then query/has/verify them
without asking the model to grep or load entire artifact trees.

---

## 13. `iso-migrate` ← deterministic consumer-project upgrades for domain packages — **DONE**

Introduced as a standalone package. `iso-migrate` does not import JobForge,
`iso-harness`, or any other domain package; it provides the on-disk JSON
migration catalog format and file operation runner that domain packages can
share. JobForge-style examples cover npm script additions, dependency range
updates, and generated-state `.gitignore` entries, but the package remains
generic: plan/apply/check/explain idempotent JSON pointer edits, object
merges, line insertion, exact replacement, and guarded file writes without
asking the model to hand-edit consumer-owned files.

---

## 14. `iso-canon` ← deterministic identity keys for domain packages — **DONE**

Introduced as a standalone package. `iso-canon` does not import JobForge,
`iso-index`, `iso-ledger`, or any other domain package; it provides the
on-disk JSON profile format and canonicalizer that domain tools can share.
JobForge-style examples cover URL tracking cleanup, company legal suffixes,
role aliases, and company-role dedupe keys, but the package remains generic:
normalize URL/company/role/company-role identifiers and return explainable
`same` / `possible` / `different` comparisons without asking the model to
remember duplicate-matching rules.

---

## 15. `iso-postflight` ← deterministic settlement for domain packages — **DONE**

Introduced as a standalone package. `iso-postflight` does not import
JobForge, `iso-preflight`, `iso-orchestrator`, `iso-ledger`, or any other
domain package; it provides the on-disk JSON config/plan/observation
contract that domain tools can share. JobForge-style examples cover
multi-round apply workflows with tracker artifacts and merge/verify
post-steps, but the package remains generic: reconcile planned candidates
with observed outcomes, required artifacts, and post-run steps, then return
the next safe action without asking the model to infer workflow state from
subagent prose.

---

## 16. `iso-redact` ← deterministic sensitive-data handling for domain packages — **DONE**

Introduced as a standalone package. `iso-redact` does not import JobForge,
`iso-trace`, `iso-guard`, `iso-eval`, or any other domain package; it
provides the on-disk JSON redaction policy format and scanner/applier that
domain tools can share. JobForge-style examples cover proxy credentials,
profile contact fields, API keys, bearer tokens, private keys, and exported
trace/fixture text, but the package remains generic: scan, apply, verify,
and explain builtin/pattern/field redaction rules without asking a model to
remember sensitive-data handling rules.

---

## 17. `iso-facts` ← deterministic fact materialization for domain packages — **DONE**

Introduced as a standalone package. `iso-facts` does not import JobForge,
`iso-index`, `iso-contract`, `iso-canon`, `iso-preflight`, or any other
domain package; it provides the on-disk JSON fact policy and fact set formats
that domain tools can share. JobForge-style examples cover report URLs/scores,
scan-history TSV rows, tracker tables, JSONL outcomes, and preflight candidate
JSON, but the package remains generic: extract/query/has/verify/check
provenance-rich fact records from local artifacts without asking a model to
reread broad source trees.

---

## 18. `iso-score` ← deterministic rubric scoring for domain packages — **DONE**

Introduced as a standalone package. `iso-score` does not import JobForge,
`iso-facts`, `iso-contract`, `iso-preflight`, or any other domain package; it
provides the on-disk JSON score config/input/result formats that domain tools
can share. JobForge-style examples cover weighted job-fit rubrics, apply
thresholds, score bands, and score comparisons, but the package remains
generic: compute weighted totals, verify content-derived result ids, evaluate
gates, and compare structured scores without asking a model to redo arithmetic
or threshold checks.

---

## 19. `iso-timeline` ← deterministic time-based next-action policy for domain packages — **DONE**

Introduced as a standalone package. `iso-timeline` does not import JobForge,
`iso-ledger`, `iso-facts`, `iso-index`, or any other domain package; it
provides the on-disk JSON timeline policy and dated event formats that domain
tools can share. JobForge-style examples cover application follow-ups,
interview thank-yous, and stale pipeline items, but the package remains
generic: compute upcoming, due, overdue, suppressed, and blocked actions from
dated events without asking a model to reason over date math or growing
tracker files.

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
- **`iso-capabilities` does not mutate harness permissions directly.**
  It emits an executable policy/checker plus compact target guidance.
  Native enforcement should stay additive and harness-specific; where a
  harness cannot enforce a field, pair the policy with `iso-trace` /
  `iso-guard` audits instead of implying a stronger guarantee.
- **`iso-context` does not load files into a harness automatically.**
  It emits a deterministic plan/check/render surface. Harness-native
  context injection should stay explicit because every harness has
  different context-loading semantics and prompt-cache behavior.
- **`iso-cache` does not decide artifact freshness for a domain.**
  It stores content-addressed entries with optional TTLs and verifies
  integrity. Domain packages still own which artifacts are safe to cache,
  how long they stay fresh, and which side-effectful operations must never
  be replayed from cache.
- **`iso-index` does not decide source precedence for a domain.**
  It builds and verifies lookup records from configured sources. Domain
  packages still own which source wins when report, tracker, scan, cache,
  and ledger facts disagree, and when an index should be rebuilt.
- **`iso-facts` does not decide domain truth or stale-fact policy.**
  It materializes configured facts with provenance. Domain packages still own
  source precedence, staleness rules, conflict handling, and how facts feed
  contracts, preflight gates, ledgers, or downstream prompts.
- **`iso-canon` does not decide duplicate policy for a domain.** It emits
  stable keys and explainable comparisons. Domain packages still own whether
  a `possible` match blocks work, warns, or routes to review, and which
  artifact source wins when canonical keys disagree with raw records.
- **`iso-score` does not decide what a domain values.** It computes configured
  rubric math, bands, comparisons, and gates. Domain packages still own the
  rubric dimensions, evidence policy, score freshness, source precedence, and
  whether a gate routes to preflight, ledger recording, human review, or
  another workflow step.
- **`iso-timeline` does not decide what a domain should follow up on.** It
  evaluates configured dated-event policy. Domain packages still own event
  extraction, source precedence, business calendars, stale-action retention,
  and whether due actions route to prompts, ledgers, notifications, or
  workflow dispatch.
- **`iso-postflight` does not decide how a domain collects observations.**
  It settles explicit plan/outcome/artifact/step records. Domain packages
  still own whether those observations come from TSV files, ledger events,
  trace exports, orchestrator state, or another authoritative source.
- **`iso-redact` does not decide which data a domain is allowed to retain.**
  It provides deterministic detectors, field rules, replacements, and
  verification. Domain packages still own their privacy policy, retention
  boundaries, false-positive tolerance, and where redaction gates run in
  export or telemetry workflows.
- **`iso-migrate` does not decide release policy for a domain.** It plans
  and applies idempotent file edits. Domain packages still own when
  migrations run, how versions map to migration catalogs, and which
  domain-specific verification commands should run afterward.

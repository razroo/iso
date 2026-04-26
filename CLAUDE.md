# iso — monorepo

Workspaces monorepo (npm) housing eleven Razroo tools that together make
AI-agent harnesses *isomorphic* — the same authored source producing the
same behavior across every coding harness (Cursor, Claude Code, Codex,
OpenCode) and every model tier (frontier → 7B local).

See `INTEGRATIONS.md` at the repo root for the backlog of open
cross-package compositions and the decouplings that are deliberate.

## Packages

**Build-time (authoring → output):**

- `packages/agentmd` — `@razroo/agentmd`. Structured-markdown dialect for
  agent prompts, linter for structure, fixture-driven adherence harness.
  TypeScript, `tsc` → `dist/`. Tests via
  `node --test --import tsx tests/*.test.ts`.
- `packages/isolint` — `@razroo/isolint`. Lints/rewrites AI harness
  markdown for weak small models; also ships an Isomorphic Plan engine.
  TypeScript, `tsc` → `dist/`. Tests via `tsx --test test/*.test.ts`.
- `packages/iso-harness` — `@razroo/iso-harness`. Transpiles one `iso/`
  source into per-agent configs (Claude / Cursor / Codex / OpenCode).
  Plain ESM `.mjs` (no TS build). Tests via
  `node --test tests/*.test.mjs`.
- `packages/iso-route` — `@razroo/iso-route`. Compiles one `models.yaml`
  policy (default model + named roles) into each harness's native config
  (`.claude/settings.json`, `.codex/config.toml`, `opencode.json`) plus
  a resolved role map for iso-harness. TypeScript, `tsc` → `dist/`.

**Wrapper:**

- `packages/iso` — `@razroo/iso`. Chains `agentmd → isolint →
  iso-route → iso-harness` behind one CLI when `models.yaml` exists.
  Plain ESM `.mjs`. Depends on the sibling packages via workspace protocol.

**Feedback (post-deploy):**

- `packages/iso-eval` — `@razroo/iso-eval`. Behavioral eval runner:
  snapshot a workspace per task, hand it to a runner, score the resulting
  filesystem/command state. TypeScript.
- `packages/iso-trace` — `@razroo/iso-trace`. Parses Claude Code JSONL
  sessions into a normalized event model for local observability. Zero
  upload. TypeScript.
- `packages/iso-guard` — `@razroo/iso-guard`. Deterministic runtime
  policy checks over normalized event streams and `iso-trace export`
  JSON/JSONL. TypeScript.

**Runtime control:**

- `packages/iso-orchestrator` — `@razroo/iso-orchestrator`. Durable
  workflow primitives for agent harnesses: resumable steps, keyed
  mutexes, bounded parallel fan-out, and file-backed run state.
  TypeScript, `tsc` → `dist/`. Tests via
  `node --test --import tsx tests/*.test.ts`.
- `packages/iso-ledger` — `@razroo/iso-ledger`. Append-only operational
  event/state ledger for agent workflows: idempotent writes, local
  queries, verification, and materialized views. TypeScript, `tsc` →
  `dist/`. Tests via `node --test --import tsx tests/*.test.ts`.
- `packages/iso-contract` — `@razroo/iso-contract`. Deterministic
  artifact contracts for agent workflows: validate, parse, and render
  JSON/TSV/markdown records without model calls. TypeScript, `tsc` →
  `dist/`. Tests via `node --test --import tsx tests/*.test.ts`.

## Conventions

- Each package owns its `package.json`, tests, README, LICENSE, and
  CHANGELOG.
- TypeScript packages extend `../../tsconfig.base.json`.
- Package names stay on the `@razroo/*` scope so npm publish flows keep
  working.
- All packages are ESM (`"type": "module"`).
- Root `scripts` fan out via `npm run <x> --workspaces --if-present`.
- Each published package has a tag-triggered release workflow at
  `.github/workflows/<pkg>-release.yml`. The workflow waits for the
  `ci-required` CI check-run on the release commit, runs
  `release:check-source` to verify the tag matches `package.json`, then
  `npm publish --provenance`. Mirror this pattern when adding a new
  package.

## Cross-package dev

- `agentmd` has a `lint:isolint` script that pipes its rendered prompts
  through `isolint`. When both are in the same workspace, prefer calling
  the sibling directly rather than the global binary.
- `iso` (wrapper) resolves sibling bins via `require.resolve` on the
  workspace package; see `packages/iso/src/pipeline.mjs`.
- `iso-route` writes `.claude/iso-route.resolved.json` as an on-disk
  contract for iso-harness to consume. Prefer file-based handoffs over
  TypeScript imports so packages stay independently installable.

## Do not

- Don't add `node_modules/`, `dist/`, or lockfiles from the former
  standalone repos. Only source + tests + examples + configs come over.
- Don't rename published package names — they're already live on npm.
- Don't design for hypothetical integrations. If a composition isn't
  listed in `INTEGRATIONS.md`, it isn't planned — ask before building.

# @razroo/iso-trace

## 0.4.0

### Minor Changes

- 66d2ff5: `@razroo/iso-trace` now parses Cursor transcripts, adds redaction helpers
  for safer exports, and can lift observed sessions into seed `iso-eval`
  fixtures for faster regression coverage.

## 0.3.1

### Patch Changes

- Improve harness inference for Claude Code JSONL sessions that begin
  with metadata records such as `permission-mode` before the first
  user/assistant message. This fixes `iso-trace stats --source ...`
  against newer Claude Code exports and restores the CI sample-session
  smoke test.

## 0.3.0

### Minor Changes

- 5f4178f: Add a built-in Codex runner to `iso-eval` so suites can execute against a
  real coding harness instead of only the fake runner.

  Expand `iso-trace` with Codex and OpenCode transcript support, session
  discovery across those harnesses, `model-score` reporting, and
  CI-friendly routing/schema regression gates for OpenCode tool usage.

## 0.2.0

### Minor Changes

- New `iso-trace export-fixture <id-or-prefix> --out <dir>` command
  (also `--source <path>` for a single JSONL). Lifts a captured session
  into an `iso-eval`-compatible fixture directory:

  - `task.md` — first user message verbatim, headed with the source
    session id
  - `workspace/` — empty placeholders for every file the agent read,
    so the maintainer can fill in the baseline state
  - `checks.yml` — one `file_exists` per write, plus `file_exists` +
    `file_contains` (value: `REPLACE_ME`) per edit. Wrapped in a
    `suite: fixture-<id>` / `runner: fake` scaffold so the fixture
    is runnable by `iso-eval run` after the checks are filled in.

  Library export `exportFixture(session, { out })` returns a
  `FixtureExportResult` with the emitted paths and touched-file lists
  for programmatic callers (e.g. batch fixture generation across a
  transcript root).

  Closes INTEGRATIONS.md #4.

## 0.1.0

### Minor Changes

- Initial release. Parse Claude Code JSONL session transcripts into a
  harness-agnostic event model so you can ask _which rules ever
  actually fired?_, _which tools does my agent reach for most?_, and
  _which captured sessions would make good regression fixtures?_ Ships
  `sources`, `list`, `show`, `stats`, and `export` commands. Zero
  upload — everything is local reads and user-controlled output. Codex
  and OpenCode parsers are additive and planned for later minor
  releases; the normalized event model is the stable contract.

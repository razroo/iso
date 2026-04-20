# @razroo/iso-trace

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
  harness-agnostic event model so you can ask *which rules ever
  actually fired?*, *which tools does my agent reach for most?*, and
  *which captured sessions would make good regression fixtures?* Ships
  `sources`, `list`, `show`, `stats`, and `export` commands. Zero
  upload — everything is local reads and user-controlled output. Codex
  and OpenCode parsers are additive and planned for later minor
  releases; the normalized event model is the stable contract.

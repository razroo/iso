# Changelog

## 1.4.0

### Changed

- **Default preset is now `recommended + performance`.** Running
  `isolint lint .` with no config and no `--preset` flag now runs both
  reliability and performance rules in one pass. Performance rules are
  all `info` severity, so this does **not** change CI exit codes under
  the default `--fail-on error` — but your text/JSON output will
  include a handful of additional `perf-*` findings on most harnesses.
  - To keep the old narrow behavior, set `{"extends": ["recommended"]}`
    in `.isolint.json` or run `isolint lint . --preset recommended`.
  - To run performance-only, use `--preset performance`.

### Fixed

- `lint` and `cost` auto-discovery of `.isolint.json` now looks in the
  **lint target directory**, not `process.cwd()`. Previously, running
  `isolint lint /other/repo` from a different shell dir picked up the
  current repo's config (if any) instead of the target's. Explicit
  `--config <path>` behavior is unchanged.

## 1.3.1

### Added

- **`lint --preset <name>`** — pick rule presets from the command line
  without writing a `.isolint.json`. Repeatable
  (`--preset recommended --preset performance`) or comma-separated
  (`--preset recommended,performance`). Overrides the config's
  `extends` when set. Valid values: `recommended`, `strict`,
  `performance`.
- Repeated string flags on the CLI now accumulate into a comma-joined
  list instead of the later value silently overwriting the earlier
  one. This makes `--preset` and `--ignore` behave the way their
  help text advertises.

## 1.3.0

### Changed

- **`isolint cost` now groups shared-prefix files by tool load group**
  instead of summing them. Claude Code loads `CLAUDE.md`; the
  AGENTS.md convention (opencode / Codex / Zed) loads `AGENTS.md` +
  `modes/_shared.md` + `.opencode/instructions.md`; Cursor loads
  `.cursor/rules/*.mdc`. A repo tracking files for multiple tools is
  no longer double-counted — each group gets its own total, and the
  "worst case" is the max across tools.
- `iso/instructions.md` is recognised as authoring source that
  compiles to each tool's file. When the tool-specific file isn't
  tracked, iso stands in as the compiled-content equivalent (with an
  explicit note per group).
- `--budget N` now guards the **worst-case tool total** instead of
  the naive sum across all shared-prefix files. This is the value you
  actually pay per turn at most.

### Deprecated

- `CostReport.shared_prefix_total_tokens` / `shared_prefix_total_words`
  — now hold the worst-case tool totals (was previously a naive sum
  across all shared-prefix files). Prefer `worst_tool_tokens` /
  `worst_tool_words` / the new `tools[]` array.

## 1.2.0

### Added
- **`isolint cost [path]`** — new command. Buckets harness files into
  shared-prefix (loaded every turn), per-mode, and per-agent, then reports
  approximate per-turn prompt-token cost with section-level breakdown for
  the always-loaded files. Same `chars ÷ 4` heuristic as
  `perf-shared-prefix-budget` so numbers line up with lint findings.
  - `--budget N` — exits non-zero when the shared-prefix total exceeds `N`
    tokens (CI guard for always-loaded context cost).
  - `--no-sections` — skip per-section breakdown.
  - `--format json` — machine-readable output.
- **Six new performance rules**:
  - `perf-rationale-in-shared-prefix` — `Why:` / `Historical note:` /
    dated incident narratives in always-loaded files.
  - `perf-emphasis-inflation` — saturated `MUST` / `NEVER` / `CRITICAL`
    density (≥8 all-caps intensifiers per 100 words).
  - `perf-cross-file-duplicate-block` — 20+ word paragraphs copy-pasted
    verbatim across ≥2 harness files; reported once on the last file
    alphabetically.
  - `perf-dense-prohibition-list` — 3+ consecutive
    `Do not X. Never Y. Must not Z.` sentences that should be a bullet
    list.
  - `perf-conditional-mode-branch-in-shared-prefix` — `if/when`
    sentences in shared prefixes that name a discovered `modes/*.md`
    mode. Tight matching: backtick-wrapped mode names,
    `<mode> mode/flow/task`, or `dispatches an <mode>` — plain noun
    collisions don't trigger.
  - `perf-nested-conditional-chain` — sentences chaining ≥3
    `if/when/unless/whenever` conditions.

### Changed
- **Scanner honors `.gitignore` by default** when run inside a git repo.
  Uses `git ls-files --cached --others --exclude-standard` as an
  allowlist so build output (generated `CLAUDE.md`, `AGENTS.md`,
  `.cursor/rules/`, `.opencode/{agents,skills}/` in iso-built repos)
  isn't linted as first-class harness content. `--no-gitignore` opts
  out. Single-file targets bypass the allowlist.
- Extracted `src/lint/paths.ts` as the single source of truth for
  harness path classification (shared prefix / mode / agent). Both
  `cost` and performance rules import from there.

### Fixed
- macOS path canonicalization via `realpathSync` so `/var` vs.
  `/private/var` doesn't break gitignore membership checks.

## 1.1.0

- Planner performance loop and harness performance tooling.

## 1.0.0

- LLM rules rework and `isolint verify`.

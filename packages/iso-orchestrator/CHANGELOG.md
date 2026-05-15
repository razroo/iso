# @razroo/iso-orchestrator

## 0.2.0

### Minor Changes

- Add optional per-target root instruction addenda to `iso-harness` so
  shared AGENTS text can stay harness-neutral while OpenCode-only guidance
  is emitted separately.

  Add `inspectSession()` / `inspectSessions()` to `iso-trace` for
  harness-agnostic worker/session summaries, and surface OpenCode session
  titles in normalized session metadata.

  Add heartbeat and renewable lease primitives to `iso-orchestrator` so
  consumers can track worker liveness and ownership without introducing
  harness-specific dispatch APIs.

## 0.1.0

### Minor Changes

- Initial release. Adds a library-first orchestration layer for agent harnesses
  with file-backed workflow records, idempotent/resumable `step()` execution,
  process-safe keyed mutexes, and bounded parallel `forEach()` fan-out.

  The package is intentionally generic: it does not know about any particular
  harness or task-dispatch surface yet, so domain packages can bring their own
  adapters.

# @razroo/iso-orchestrator

## 0.1.0

### Minor Changes

- Initial release. Adds a library-first orchestration layer for agent harnesses
  with file-backed workflow records, idempotent/resumable `step()` execution,
  process-safe keyed mutexes, and bounded parallel `forEach()` fan-out.

  The package is intentionally generic: it does not know about any particular
  harness or task-dispatch surface yet, so domain packages can bring their own
  adapters.

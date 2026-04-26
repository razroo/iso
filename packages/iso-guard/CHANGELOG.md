# @razroo/iso-guard

## 0.1.0

### Minor Changes

- Introduce `@razroo/iso-guard`, a deterministic CLI/library for auditing agent workflow events against machine-readable runtime policy without adding prompt or MCP token overhead.
- Adds deterministic policy auditing over normalized event streams and
  `iso-trace export` JSON/JSONL.
- Supports `max-per-group`, `require-before`, `require-after`,
  `forbid-text`, and `no-overlap` rules.

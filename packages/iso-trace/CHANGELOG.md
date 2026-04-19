# @razroo/iso-trace

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

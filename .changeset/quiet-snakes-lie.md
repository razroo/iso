---
"@razroo/iso-eval": minor
"@razroo/iso-trace": minor
---

`@razroo/iso-eval` now ships packaged real-agent runners for Claude Code,
Cursor, and OpenCode alongside Codex, and can stage the generated harness
files each runner expects before replaying a suite.

`@razroo/iso-trace` now parses Cursor transcripts, adds redaction helpers
for safer exports, and can lift observed sessions into seed `iso-eval`
fixtures for faster regression coverage.

---
"@razroo/iso-route": patch
---

Restore the shipped `iso-route verify` surface by wiring the CLI command,
re-enabling `build --verify-models` from source builds, and exporting the
verification helpers from the package entrypoint.

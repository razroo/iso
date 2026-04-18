---
name: release-check
description: Verify package versions, release tags, and publish workflows before a release.
args: "[package]"
targets:
  cursor: skip
  codex: skip
---

Check the release state for this repo.

1. Read the target package `package.json`.
2. Read the matching release workflow under `.github/workflows/`.
3. Confirm the expected tag prefix and the package version.
4. Report any mismatch that would block a publish.

Return plain text with the result first, then the files checked.

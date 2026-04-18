---
name: review
description: Review the current git diff for code-quality issues.
args: "[scope]"
targets:
  cursor: skip
  codex: skip
---

Review the pending changes on this branch.

1. Run `git diff` to see the current changes.
2. Flag issues in three buckets: **correctness**, **clarity**, **risk**.
3. For each issue include the `file:line` pointer.
4. End with a one-line verdict: ship / needs changes / blocked.

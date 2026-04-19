---
"@razroo/isolint": patch
---

Fix cross-reference rules when linting a subdirectory.

`isolint lint modes/` previously rooted the repo-file scan and `ctx.file`
at the lint target instead of the actual repo root. This produced two
classes of bug: (1) stale-link-reference flagged every `[..](../X.md)`
link to a project-root file because those files weren't in `repo_files`,
and (2) every rule that gates on `ctx.file.match(/modes\/|prompts\/|…/)`
silently skipped because `ctx.file` was target-relative (`README.md`)
instead of repo-relative (`modes/README.md`).

`discoverRepoFiles` now scans from the git root (or `process.cwd()`
outside a git checkout), and discovered file `rel_path` values are
re-based to the repo root before reaching rules. Behavior when linting
the project root (`isolint lint .`) is unchanged.

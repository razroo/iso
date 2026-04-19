# @razroo/iso

## 0.2.0

### Minor Changes

- Compose `@razroo/iso-route` into the build pipeline. When the project
  has a `models.yaml` at its root (or `iso/models.yaml`), the wrapper
  inserts an `iso-route build` step before `iso-harness build`, so the
  resolved role map is on disk when iso-harness reads it to stamp
  per-subagent `model:` frontmatter. Adds a new `--skip-iso-route` CLI
  flag that opts out explicitly; the step is also skipped automatically
  when no `models.yaml` exists, so existing projects see no behavior
  change. Bumps the `@razroo/iso-harness` dep to `^0.4.0` to pick up
  the resolved-map consumer.

## 0.1.1

### Patch Changes

- Updated dependencies
  - @razroo/iso-harness@0.3.0

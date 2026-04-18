# @razroo/agentmd

## 0.3.0

### Minor Changes

- Add `agentmd lint --format sarif` so findings upload to GitHub code
  scanning with the same dialect as `isolint --format sarif`. The driver
  name is `agentmd`, rule IDs are the L-codes, severities map to SARIF
  `error` / `warning` / `note`.

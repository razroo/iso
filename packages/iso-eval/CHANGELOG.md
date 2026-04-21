# @razroo/iso-eval

## 0.3.0

### Minor Changes

- 5f4178f: Add a built-in Codex runner to `iso-eval` so suites can execute against a
  real coding harness instead of only the fake runner.

  Expand `iso-trace` with Codex and OpenCode transcript support, session
  discovery across those harnesses, `model-score` reporting, and
  CI-friendly routing/schema regression gates for OpenCode tool usage.

## 0.2.0

### Minor Changes

- New `agentmd_adherence` check type. Scores per-rule adherence of an
  agentmd-dialect prompt against a fixture file by shelling out to
  `agentmd test --format json`, computes the pass rate for `ruleId`
  (or overall when omitted), and fails the check when the rate is
  below `minPassRate`. Tests can inject a fake `AgentmdSpawnFn` via
  the library API so CI runs offline without an API key; the default
  spawn resolves `@razroo/agentmd`'s CLI bin via Node module resolution
  so PATH setup doesn't matter.

  Shape:

  ```yaml
  - type: agentmd_adherence
    promptFile: ../agent.md
    fixtures: ../fixtures.yml
    ruleId: H3 # optional
    minPassRate: 0.9
    via: claude-code # optional (api | claude-code | fake)
    model: claude-haiku-4-5 # optional
    timeoutMs: 180000 # optional
  ```

  Adds `@razroo/agentmd` as a runtime dependency so installing
  iso-eval pulls in the agentmd CLI.

  Closes INTEGRATIONS.md #3.

## 0.1.0

### Minor Changes

- Initial release. Behavioral eval runner for AI coding agents:
  snapshots a workspace per task, hands it to a runner with a task
  prompt, scores the resulting filesystem / command state against
  declared checks (`command`, `file_exists`, `file_contains`,
  `file_not_contains`, `file_matches`, `llm_judge`). Ships a
  deterministic `fake` runner (executes `$ …` lines from the prompt in
  the snapshotted workspace) so the orchestration layer can run offline
  and in CI. Real-agent runners (`claude-code`, `codex`, `cursor-agent`)
  plug in via the library `RunnerFn` interface today; named runner
  support lands in v0.2. Includes `iso-eval run` and `iso-eval plan`
  CLIs plus library exports for custom orchestration.

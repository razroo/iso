# @razroo/iso-eval

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

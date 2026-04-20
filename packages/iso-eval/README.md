# @razroo/iso-eval

**Behavioral eval runner for AI coding agents.**

`agentmd` lints prompt *structure*, `isolint` lints prompt *prose*,
`iso-harness` fans out the compiled source into every harness file layout.
None of them answer the next question: *did the agent actually do the
task?* That's what `@razroo/iso-eval` scores.

You give it a suite of tasks — each with a baseline workspace, a prompt,
and a set of checks — and it snapshots the workspace per trial, hands it
to a runner, then verifies the resulting filesystem / command state
against your checks.

> **v0.1 scope:** ships a deterministic `fake` runner (executes `$ …`
> lines from the prompt as shell in the snapshotted workspace) so the
> orchestration layer can be exercised offline and in CI. Real-agent
> runners (`claude-code`, `codex`, `cursor-agent`) are coming in v0.2;
> the library API already accepts any `RunnerFn` today.

## Install

```bash
npm install -D @razroo/iso-eval
```

## Suite shape

```yaml
# eval.yml
suite: refactor-basic
runner: fake              # v0.1 ships fake; custom runners via the library API
timeoutMs: 120000

tasks:
  - id: write-greeting
    prompt: tasks/write-greeting.md    # path (relative to eval.yml) or inline
    workspace: workspace/              # baseline dir, copied per-trial into tmpdir
    trials: 1
    checks:
      - { type: file_exists,       path: greeting.txt }
      - { type: file_contains,     path: greeting.txt, value: "hello" }
      - { type: file_not_contains, path: greeting.txt, value: "TODO"  }
      - { type: command, run: "test -f greeting.txt", expectExit: 0 }
```

### Supported checks

| type                  | asserts                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `command`             | shell command exits with `expectExit` (default 0); optional stdout contains/matches |
| `file_exists`         | file at `path` exists in the workspace                           |
| `file_contains`       | file at `path` contains the literal substring `value`            |
| `file_not_contains`   | file at `path` does NOT contain `value`                          |
| `file_matches`        | file at `path` matches the regex `matches`                       |
| `llm_judge`           | a user-supplied `JudgeFn` answers yes to `prompt` against runner stdout/stderr |
| `agentmd_adherence`   | per-rule pass rate from `agentmd test` meets `minPassRate`; optional `ruleId` filter |

### `agentmd_adherence`

```yaml
- type: agentmd_adherence
  promptFile: ../agent.md         # path to agentmd source (relative to eval.yml)
  fixtures: ../fixtures.yml       # path to agentmd fixture file
  ruleId: H3                      # optional — score only this rule
  minPassRate: 0.9                # required — pass rate floor in [0, 1]
  via: claude-code                # optional — default claude-code (api | claude-code | fake)
  model: claude-haiku-4-5         # optional — forwarded as --model
  timeoutMs: 180000               # optional — subprocess timeout
```

Shells out to the `agentmd` CLI (bundled as a runtime dependency) via
`agentmd test <promptFile> --fixtures <fixtures> --format json`, parses
the per-rule check outcomes, computes the pass rate for `ruleId` (or
overall if omitted), and fails the check when the rate is below
`minPassRate`. Tests can inject a fake subprocess runner via the
library API (`AgentmdSpawnFn`) so CI doesn't need an API key.

## CLI

```bash
iso-eval run  examples/suites/echo-basic/eval.yml
iso-eval plan examples/suites/echo-basic/eval.yml

iso-eval run eval.yml --filter write-greeting --concurrency 2 --json
iso-eval run eval.yml --keep-workspaces           # skip tmpdir cleanup for debugging
```

`run` exits 0 on all-pass, 1 on any failure, 2 on invalid invocation.

## Library API

```ts
import { loadSuite, run, formatReport, fakeRunner } from "@razroo/iso-eval";

const suite = loadSuite("./eval.yml");
const report = await run(suite, {
  runner: fakeRunner,
  concurrency: 2,
  onTaskComplete: (t) => console.log(t.id, t.passed ? "✓" : "✗"),
});
console.log(formatReport(report));
process.exit(report.passed ? 0 : 1);
```

### Bring your own runner

The YAML `runner:` field selects from shipped runners; the library
accepts any `RunnerFn`:

```ts
import type { RunnerFn } from "@razroo/iso-eval";

const myRunner: RunnerFn = async ({ workspaceDir, taskPrompt, timeoutMs }) => {
  // spawn your agent (claude -p / codex exec / …) with cwd = workspaceDir
  // return { exitCode, stdout, stderr, durationMs }
};
```

### Bring your own judge (for `llm_judge` checks)

```ts
import type { JudgeFn } from "@razroo/iso-eval";

const judge: JudgeFn = async (prompt, output) => {
  // call your model; return true if the rule was followed
};

await run(suite, { runner: fakeRunner, judge });
```

## How this fits the rest of the pipeline

```
agent.md  →  agentmd lint  →  agentmd render  →  isolint lint  →  iso-harness build
                                                                         │
                                                                         ▼
                                                          project w/ CLAUDE.md etc.
                                                                         │  iso-eval run
                                                                         ▼
                                                                per-task pass / fail
```

- **`@razroo/agentmd`** measures *per-rule adherence* on text output
  (input string → output string → check).
- **`@razroo/iso-eval`** measures *task success* on a real workspace
  (snapshot dir → agent acts → filesystem state → check).

The two compose: an `iso-eval` suite can include `llm_judge` checks that
reuse the same judge convention (`yes` = rule followed) and, in the
future, an explicit `agentmd_adherence` check that folds a fixture-level
adherence score into the task report.

## License

MIT — see [LICENSE](./LICENSE).

# @razroo/iso-guard

**Runtime policy checks for AI-agent workflows.**

`isolint` makes harness prose easier for weak models to follow. `iso-guard`
checks whether an actual run followed the operational rules. It reads local
files and trace exports; it does not call a model, start an MCP server, or
inject policy text into every prompt.

Use it for rules such as:

- no more than N task dispatches per round
- cleanup must happen before a dispatch
- merge and verify must happen after a batch
- task prompts must not contain raw proxy credentials
- the same company/role must not be dispatched twice while still in flight

## Install

```bash
npm install -D @razroo/iso-guard
```

## CLI

```bash
iso-guard audit guard.yaml --events events.json
iso-guard audit guard.yaml --events events.jsonl --json
iso-guard verify guard.yaml --events session.json --fail-on warn
iso-guard explain guard.yaml
```

`audit` and `verify` are aliases. `--events` accepts:

- a JSON array of normalized guard events
- newline-delimited JSON guard events
- `iso-trace export <session> --format json`
- `iso-trace export <session> --format jsonl`

Text output stays intentionally compact:

```text
iso-guard: PASS (4 rules, 12 events)
```

JSON output is suitable for scripts:

```json
{
  "ok": false,
  "errors": 1,
  "warnings": 0,
  "violations": [
    {
      "ruleId": "H3",
      "severity": "error",
      "message": "event #3 matched trigger but no required event appeared before it"
    }
  ]
}
```

## Policy Shape

```yaml
version: 1
rules:
  - id: max-two-task-dispatches
    type: max-per-group
    severity: error
    match: { type: tool_call, name: task }
    groupBy: round
    max: 2

  - id: cleanup-before-task
    type: require-before
    trigger: { type: tool_call, name: task }
    require: { type: tool_call, name: geometra_disconnect }
    groupBy: round

  - id: merge-and-verify-after-apply
    type: require-after
    ifAny: { type: tool_call, name: task, fields: { mode: apply } }
    require:
      - { type: tool_call, name: job-forge-merge }
      - { type: tool_call, name: job-forge-verify }

  - id: no-proxy-secrets
    type: forbid-text
    match: { type: tool_call, name: task }
    patterns:
      - { source: "\\b(server|username|password|bypass)\\s*:", flags: "i" }

  - id: no-same-company-overlap
    type: no-overlap
    start: { type: task_start }
    end: { type: task_end }
    keyBy: companyRole
```

### Event Shape

The native event format is intentionally small:

```json
[
  { "type": "tool_call", "name": "geometra_disconnect", "data": { "round": 1 } },
  { "type": "tool_call", "name": "task", "data": { "round": 1, "mode": "apply" } }
]
```

Selectors match `type`, `name`, optional regex over `text`, and exact
`fields`. Field lookup checks top-level event properties first, then
`event.data`, and supports dotted paths.

## Library API

```ts
import { audit, loadPolicy, loadEvents } from "@razroo/iso-guard";

const policy = loadPolicy("guard.yaml");
const events = loadEvents("events.json");
const result = audit(policy, events);
if (!result.ok) process.exit(1);
```

## Fit With The iso Stack

- `iso-harness` emits agent configs.
- `iso-orchestrator` runs durable workflows.
- `iso-trace` exports what happened.
- `iso-guard` checks the run against machine-readable policy.

The boundary is deliberate: policy enforcement happens outside the model
context unless you explicitly ask an agent to run the CLI and read the
compact result.

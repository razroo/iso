# @razroo/iso-postflight

`iso-postflight` answers: **is this dispatched agent workflow settled, and
what is the next safe action?**

It is a deterministic, local CLI/library for reconciling a dispatch plan with
observed outcomes, artifact evidence, and post-run steps. It does not call a
model, does not run an MCP server, and does not add prompt or tool-schema
tokens.

Use it after `iso-preflight` or any other planner has emitted bounded rounds:

- detect in-flight work that should not be re-dispatched
- detect missing outcomes for already-dispatched candidates
- require output artifacts such as tracker TSVs before a round is complete
- identify failed outcomes that need replacement candidates
- decide when to dispatch the next round
- require post-steps such as merge and verify before declaring the workflow complete

## Install

```bash
npm install @razroo/iso-postflight
```

## CLI

```bash
iso-postflight status --config postflight.json --plan plan.json --outcomes outcomes.json
iso-postflight check --config postflight.json --plan plan.json --outcomes outcomes.json
iso-postflight explain --config postflight.json
```

Use `--workflow <name>` when a config contains multiple workflows, and `--json`
for machine-readable output. `check` exits `1` unless the workflow is fully
complete.

## JobForge-style usage

```bash
iso-postflight status \
  --config examples/jobforge-postflight.json \
  --plan examples/jobforge-plan.json \
  --outcomes examples/jobforge-outcomes-partial.json
```

Example output:

```text
iso-postflight: STATUS workflow=jobforge.apply
state: ready-for-next-round
next: dispatch-round - Dispatch round 2.
rounds: 1 complete, 1 not-started
outcomes: 2 succeeded, 0 failed, 0 skipped, 0 replacement, 0 in-flight, 0 missing, 0 blocked
round details:
  1. complete: job-1=succeeded, job-2=succeeded
  2. not-started: job-3=not-started
post:
  - merge: pending
  - verify: pending
```

## Config shape

```json
{
  "version": 1,
  "workflows": [
    {
      "name": "jobforge.apply",
      "successStatuses": ["APPLIED"],
      "failureStatuses": ["APPLY FAILED"],
      "skipStatuses": ["SKIP", "Discarded"],
      "inFlightStatuses": ["running", "in-flight"],
      "replacementStatuses": ["APPLY FAILED"],
      "requiredArtifacts": [
        {
          "id": "tracker-tsv",
          "label": "Tracker TSV outcome",
          "statuses": ["APPLIED", "APPLY FAILED", "SKIP", "Discarded"]
        }
      ],
      "postSteps": [
        { "id": "merge", "label": "Merge tracker TSV outcomes", "command": "npx job-forge merge" },
        { "id": "verify", "label": "Verify tracker integrity", "command": "npx job-forge verify" }
      ]
    }
  ]
}
```

## Plan shape

The plan can be the JSON output from `iso-preflight plan --json`, or this
minimal shape:

```json
{
  "workflow": { "name": "jobforge.apply" },
  "rounds": [
    { "index": 1, "candidates": [{ "id": "job-1" }, { "id": "job-2" }] },
    { "index": 2, "candidates": [{ "id": "job-3" }] }
  ]
}
```

## Outcome shape

```json
{
  "dispatches": [
    { "candidateId": "job-1", "source": "trace:root" }
  ],
  "outcomes": [
    {
      "candidateId": "job-1",
      "status": "APPLIED",
      "source": "batch/tracker-additions/001-acme.tsv",
      "artifacts": [
        { "id": "tracker-tsv", "status": "present", "source": "batch/tracker-additions/001-acme.tsv" }
      ]
    }
  ],
  "steps": [
    { "id": "merge", "status": "pass", "source": "npx job-forge merge" }
  ]
}
```

## Library

```ts
import {
  formatPostflightResult,
  loadPostflightConfig,
  settlePostflight,
} from "@razroo/iso-postflight";

const result = settlePostflight(config, plan, outcomes);
console.log(formatPostflightResult(result));
if (!result.ok) process.exit(1);
```

## Boundaries

`iso-postflight` does not dispatch agents, poll task systems, parse transcripts,
or merge tracker files. Domain code should materialize observations from
authoritative sources such as trace exports, TSV files, ledgers, or workflow
records, then feed those observations into `iso-postflight`.

Related packages:

- `iso-preflight` checks safety before dispatch.
- `iso-orchestrator` owns durable execution and fan-out primitives.
- `iso-ledger` stores durable workflow events.
- `iso-trace` parses production transcripts.
- `iso-guard` audits policy violations after a run.
- `iso-postflight` reconciles observed outputs into a next-action gate.

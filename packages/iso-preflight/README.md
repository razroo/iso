# @razroo/iso-preflight

`iso-preflight` answers: **is this agent workflow safe to dispatch, and what
rounds should run?**

It is a deterministic, local CLI/library for validating file-backed candidate
facts, applying precomputed skip/block gates, and producing bounded dispatch
plans before browser/MCP/tool-heavy agent work starts. It does not call a model,
does not run an MCP server, and does not add prompt or tool-schema tokens.

## Install

```bash
npm install @razroo/iso-preflight
```

## CLI

```bash
iso-preflight plan --config preflight.json --candidates candidates.json
iso-preflight check --config preflight.json --candidates candidates.json
iso-preflight explain --config preflight.json
```

Use `--workflow <name>` when a config contains multiple workflows, and `--json`
for machine-readable output. `check` exits `1` if any candidate is blocked.

## JobForge-style usage

```bash
iso-preflight plan \
  --config examples/jobforge-preflight.json \
  --candidates examples/jobforge-candidates.json
```

Example output:

```text
iso-preflight: PLAN workflow=jobforge.apply
candidates: 3 ready, 1 skipped, 0 blocked, 2 round(s)
pre:
  - geometra-cleanup: geometra_list_sessions && geometra_disconnect({ closeBrowser: true })
rounds:
  1. job-1, job-2
  2. job-3
skipped:
  - job-4: already applied according to artifact index @ .jobforge-index.json
post:
  - merge: npx job-forge merge
  - verify: npx job-forge verify
```

## Config shape

```json
{
  "version": 1,
  "workflows": [
    {
      "name": "jobforge.apply",
      "roundSize": 2,
      "idFact": "id",
      "conflictFact": "companyKey",
      "requiredFacts": ["id", "company", "role", "companyRoleKey", "url"],
      "sourceRequiredFacts": ["company", "role", "companyRoleKey", "url"],
      "requireGateSources": true,
      "gatePolicy": {
        "skipStatuses": ["skip"],
        "blockStatuses": ["block", "fail"]
      },
      "preSteps": [{ "id": "cleanup", "label": "Cleanup", "command": "npx example cleanup" }],
      "postSteps": [{ "id": "verify", "label": "Verify", "command": "npx example verify" }]
    }
  ]
}
```

## Candidate shape

Candidates carry facts and gate outcomes produced by domain code. A fact can be
a raw JSON value or `{ "value": ..., "source": "path:line" }`. Facts listed in
`sourceRequiredFacts` must use the object form with a source.

```json
{
  "candidates": [
    {
      "facts": {
        "id": { "value": "job-1", "source": "reports/001.md:3" },
        "company": { "value": "Anthropic", "source": "reports/001.md:6" },
        "companyKey": { "value": "company:anthropic", "source": "templates/canon.json" }
      },
      "gates": [
        { "id": "duplicate", "status": "pass", "source": ".jobforge-index.json" }
      ]
    }
  ]
}
```

## Library

```ts
import {
  formatPreflightPlan,
  loadPreflightConfig,
  parseJson,
  planPreflight,
} from "@razroo/iso-preflight";

const config = loadPreflightConfig(parseJson(configText));
const result = planPreflight(config, parseJson(candidatesText), {
  workflow: "jobforge.apply",
});

console.log(formatPreflightPlan(result));
```

## Boundaries

`iso-preflight` does not discover candidates, canonicalize identities, query
indexes, or inspect ledgers by itself. Domain packages should use tools such as
`iso-canon`, `iso-index`, `iso-ledger`, and `iso-contract` to produce candidate
facts and gates, then feed those facts into `iso-preflight` for the final safe
dispatch plan.

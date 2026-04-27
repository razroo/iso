# @razroo/iso-prioritize

Deterministic policy-based queue prioritization for AI-agent workflows.

`iso-prioritize` turns local facts into an ordered work queue without asking a model to decide what matters next. It ranks items with weighted criteria, applies gates, boosts/penalties, per-field quotas, and emits an auditable JSON result.

## Why

Agent systems often know the facts but still spend model tokens deciding:

- which evaluated jobs to apply to first
- which due follow-ups matter most
- which pipeline URLs should be processed next
- which replacement candidate to choose after a duplicate is skipped

This package moves that decision into local executable policy.

## CLI

```bash
iso-prioritize rank \
  --config examples/jobforge-prioritize.json \
  --items examples/jobforge-items.json

iso-prioritize select \
  --config examples/jobforge-prioritize.json \
  --items examples/jobforge-items.json \
  --limit 3 \
  --out /tmp/selected.json

iso-prioritize check \
  --config examples/jobforge-prioritize.json \
  --items examples/jobforge-items.json \
  --min-selected 3

iso-prioritize verify --result /tmp/selected.json
iso-prioritize explain --config examples/jobforge-prioritize.json
```

## Config Shape

```json
{
  "version": 1,
  "defaults": { "profile": "jobforge-next-action", "limit": 3 },
  "profiles": [
    {
      "name": "jobforge-next-action",
      "criteria": [
        { "id": "fit-score", "field": "score", "weight": 45, "min": 0, "max": 5 },
        { "id": "urgency", "field": "urgency", "weight": 30, "min": 0, "max": 10 }
      ],
      "gates": [
        {
          "id": "duplicate",
          "action": "skip",
          "reason": "duplicate candidate",
          "when": { "where": { "duplicate": true } }
        }
      ],
      "quotas": [
        { "id": "one-per-company", "field": "company", "max": 1 }
      ]
    }
  ]
}
```

Field paths first check top-level item fields, then `item.data`. For example, `score` resolves `item.score` if present, otherwise `item.data.score`.

## Item Shape

```json
{
  "id": "followup-datadog",
  "key": "company-role:datadog:staff-ai-engineer",
  "type": "followup",
  "title": "Datadog - Staff AI Engineer follow-up",
  "tags": ["followup"],
  "data": {
    "company": "Datadog",
    "score": 4.1,
    "urgency": 9,
    "ageDays": 10,
    "sourceQuality": 1,
    "status": "Applied",
    "timelineState": "due"
  },
  "source": { "path": "data/applications/2026-04-17.md", "line": 8 }
}
```

## Library

```ts
import {
  prioritize,
  selectPrioritized,
  checkPrioritize,
  verifyPrioritizeResult,
} from "@razroo/iso-prioritize";

const result = prioritize(config, items, { profile: "jobforge-next-action", limit: 5 });
const selected = selectPrioritized(result);
```

## Design Notes

- No MCP server.
- No model call.
- No prompt/tool-schema tokens unless you deliberately paste output into a prompt.
- Stable content hash IDs make results verifiable.
- Inputs stay generic so consumers can rank jobs, tasks, bugs, follow-ups, or any local work queue.

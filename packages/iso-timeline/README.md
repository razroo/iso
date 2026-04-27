# @razroo/iso-timeline

Deterministic time-based next-action planning for agent workflows.

`iso-timeline` turns dated domain events plus a local JSON policy into a
compact action queue: upcoming, due, overdue, suppressed, and blocked items.
It is MCP-free and model-free, so a domain package can answer "what needs
attention now?" without asking an agent to reread growing trackers or reason
manually over dates.

## Install

```bash
npm install @razroo/iso-timeline
```

## CLI

```bash
iso-timeline plan --config timeline.json --events events.jsonl --now 2026-04-27T00:00:00Z
iso-timeline due --config timeline.json --events events.jsonl --now 2026-04-27T00:00:00Z
iso-timeline check --config timeline.json --events events.jsonl --fail-on overdue
iso-timeline verify --timeline timeline-result.json
iso-timeline explain --config timeline.json
```

Events may be a JSON array, an object with an `events` array, or JSONL with
one event per line.

## Policy Shape

```json
{
  "version": 1,
  "defaults": {
    "overdueAfter": "7d",
    "latestOnly": true
  },
  "rules": [
    {
      "id": "applied-follow-up",
      "action": "send_follow_up",
      "match": {
        "type": "application.status",
        "where": { "data.status": "Applied" }
      },
      "after": "7d",
      "suppressWhen": [
        { "type": ["application.follow_up", "application.rejected"] }
      ]
    }
  ]
}
```

Each rule selects matching events, computes `dueAt = event.at + after`, marks
items overdue after `overdueAfter`, and suppresses or blocks actions when later
same-key events match `suppressWhen` or `blockWhen`.

## Library

```ts
import {
  checkTimeline,
  loadTimelineConfig,
  loadTimelineEvents,
  planTimeline,
} from "@razroo/iso-timeline";

const config = loadTimelineConfig(policyJson);
const events = loadTimelineEvents(eventJson);

const plan = planTimeline(config, events, {
  now: "2026-04-27T00:00:00.000Z",
});

const check = checkTimeline(config, events, {
  now: "2026-04-27T00:00:00.000Z",
  failOn: "overdue",
});
```

## Design Boundary

`iso-timeline` does not decide what a domain considers important. The domain
owns the event types, source precedence, and cadence rules. This package only
provides the deterministic local planner that evaluates those rules.

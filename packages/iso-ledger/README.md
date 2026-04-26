# @razroo/iso-ledger

**Append-only operational state for agent workflows.**

`state-trace` is working memory. `iso-trace` is transcript observation.
`iso-guard` checks whether a run followed policy. `iso-ledger` is the
small deterministic layer for workflow truth: append validated events,
dedupe by idempotency key, query before side effects, verify the file,
and materialize a compact state view.

It is local-only, model-free, and MCP-free. The default storage format is
newline-delimited JSON at `.iso-ledger/events.jsonl`.

## Install

```bash
npm install -D @razroo/iso-ledger
```

## CLI

```bash
iso-ledger init

iso-ledger append application.submitted \
  --key "url:https://example.test/jobs/123" \
  --subject "job:example:ai-engineer" \
  --idempotency-key "apply:https://example.test/jobs/123" \
  --data '{"status":"applied"}'

iso-ledger has --key "url:https://example.test/jobs/123"
iso-ledger query --type application.submitted --where status=applied
iso-ledger verify
iso-ledger materialize --out state.json
```

Every command accepts `--ledger <events.jsonl>`. `append`, `query`,
`has`, `verify`, and `materialize` also support `--json`.

## Event Shape

```json
{
  "id": "evt_apply_001",
  "type": "application.submitted",
  "at": "2026-04-26T00:10:00.000Z",
  "key": "url:https://example.test/jobs/123",
  "subject": "job:example:ai-engineer",
  "idempotencyKey": "apply:https://example.test/jobs/123",
  "data": {
    "status": "applied"
  },
  "meta": {
    "runId": "demo"
  }
}
```

Fields:

- `id` uniquely identifies one event. If omitted, `iso-ledger` derives it.
- `type` names the event, usually `domain.verb`.
- `at` is an ISO timestamp. If omitted on append, current time is used.
- `key` is a lookup key such as a URL, company+role, or external id.
- `subject` is the entity being materialized.
- `idempotencyKey` prevents duplicate appends for the same side effect.
- `data` is domain state.
- `meta` is provenance such as run id, source, or tool.

## Library API

```ts
import { appendEvent, hasEvent, queryEvents, readLedger } from "@razroo/iso-ledger";

await appendEvent({ dir: process.cwd() }, {
  type: "application.submitted",
  key: "url:https://example.test/jobs/123",
  subject: "job:example:ai-engineer",
  idempotencyKey: "apply:https://example.test/jobs/123",
  data: { status: "applied" },
});

const events = readLedger({ dir: process.cwd() });
if (hasEvent(events, { key: "url:https://example.test/jobs/123" })) {
  // skip duplicate side effect
}
```

The API is synchronous on purpose. Ledger files are small operational
state files, and synchronous local reads make shell/CLI adapters simple.

## Fit With The iso Stack

- `iso-orchestrator` controls durable workflow execution.
- `iso-ledger` records canonical domain events and idempotency keys.
- `iso-trace` observes harness transcripts.
- `iso-guard` audits policy over trace or ledger-derived events.

For JobForge, the future adapter can record scan/application/tracker
events here, then materialize markdown/TSV views as compatibility output.

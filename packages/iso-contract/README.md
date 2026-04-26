# @razroo/iso-contract

**Deterministic artifact contracts for agent workflows.**

Agents are good at prose and weak at remembering exact artifact formats.
`iso-contract` moves those formats into local JSON contracts that scripts
and agents can validate, parse, and render without model calls.

It is local-only, dependency-free, and MCP-free. Use it for records such
as tracker rows, batch outcomes, report headers, scan candidates, or any
other workflow artifact that must remain machine-readable.

## Install

```bash
npm install -D @razroo/iso-contract
```

## CLI

```bash
iso-contract list --contracts contracts.json
iso-contract explain jobforge.tracker-row --contracts contracts.json

iso-contract validate jobforge.tracker-row \
  --contracts contracts.json \
  --input @tracker-row.json

iso-contract render jobforge.tracker-row \
  --contracts contracts.json \
  --input @tracker-row.json \
  --format tsv

iso-contract parse jobforge.tracker-row \
  --contracts contracts.json \
  --format tsv \
  --input "812	2026-04-26	Example Labs	Staff Agent Engineer	Applied	4.2/5	yes	[812](reports/812-example-labs-2026-04-26.md)	Submitted"
```

Every command accepts `--json` for machine-readable output.

## Contract Shape

```json
{
  "contracts": [
    {
      "name": "jobforge.tracker-row",
      "version": "1.0.0",
      "fields": [
        { "name": "num", "type": "integer", "required": true },
        { "name": "date", "type": "date", "required": true },
        { "name": "status", "type": "enum", "values": ["Evaluated", "Applied"] },
        { "name": "score", "type": "score" }
      ],
      "formats": {
        "tsv": {
          "style": "delimited",
          "delimiter": "tab",
          "fields": ["num", "date", "status", "score"]
        }
      }
    }
  ]
}
```

Supported field types:

- `string`
- `integer`
- `number`
- `boolean`
- `enum`
- `date`
- `datetime`
- `url`
- `markdown-link`
- `score`
- `json`

Supported render/parse formats:

- `json`
- named delimited formats such as `tsv`
- named `markdown-table-row` formats

## Library API

```ts
import {
  getContract,
  loadContractCatalog,
  renderRecord,
  validateRecord,
} from "@razroo/iso-contract";

const catalog = loadContractCatalog(JSON.parse(rawContracts));
const contract = getContract(catalog, "jobforge.tracker-row");
const validation = validateRecord(contract, record);
const tsv = renderRecord(contract, record, "tsv").text;
```

## Fit With The iso Stack

- `iso-contract` defines artifact shape.
- `iso-ledger` records domain events about those artifacts.
- `iso-orchestrator` controls durable workflow execution.
- `iso-guard` audits whether workflow policy was followed.
- `iso-trace` observes what agents actually did.

For JobForge, contracts can replace repeated prompt prose for TSV rows,
pipeline entries, scan candidates, report headers, and subagent outcomes.

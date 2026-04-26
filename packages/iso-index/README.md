# @razroo/iso-index

Deterministic local artifact index for AI-agent workflows.

`iso-index` answers: **where is the authoritative fact?** It crawls configured
local artifacts, extracts stable records, writes a compact JSON index, and lets
agents query that index instead of repeatedly grepping or loading growing files
into prompt context.

It is:

- **MCP-free**: no tool schema or always-on prompt tokens.
- **Model-free**: extraction is regex/table/JSONL/template based.
- **Domain-neutral**: JobForge examples are included, but the package only knows
  about local files, records, keys, values, sources, and fields.

## Install

```bash
npm install @razroo/iso-index
```

## CLI

```bash
iso-index build --config index.json --root . --out .iso-index.json
iso-index query "example labs" --index .iso-index.json
iso-index has --index .iso-index.json --key "company-role:example-labs:staff-agent-engineer"
iso-index verify --index .iso-index.json
iso-index explain --config index.json
```

## JobForge-Style Example

```bash
iso-index build \
  --config examples/jobforge-index.json \
  --root examples/jobforge-project \
  --out /tmp/jobforge.iso-index.json

iso-index query \
  --index /tmp/jobforge.iso-index.json \
  --key "company-role:example-labs:staff-agent-engineer"

iso-index has \
  --index /tmp/jobforge.iso-index.json \
  --kind jobforge.report.url \
  --key "url:https://example.test/jobs/123"
```

## Config Shape

```json
{
  "version": 1,
  "sources": [
    {
      "name": "reports",
      "include": ["reports/*.md"],
      "format": "text",
      "rules": [
        {
          "kind": "report.url",
          "pattern": "^\\*\\*URL:\\*\\*\\s*(?<url>https?://\\S+)",
          "key": "url:{url}",
          "value": "{source}",
          "fields": { "url": "{url}", "report": "{source}" },
          "tags": ["report", "url"]
        }
      ]
    }
  ]
}
```

Supported source formats:

- `text`: line-by-line regex rules with named capture groups.
- `tsv`: delimited rows with headers or explicit columns.
- `markdown-table`: markdown table rows keyed by header names.
- `jsonl`: one JSON object per line, flattened with dot paths.

Template placeholders support fields plus `{source}` and `{line}`. Filters:

- `{Company|slug}` → `example-labs`
- `{Status|lower}` → `applied`
- `{Role|trim}` → trims whitespace
- `{field|json}` → JSON stringifies the value

## Library

```ts
import {
  buildIndex,
  hasIndexRecord,
  loadIndexConfig,
  queryIndex,
  verifyIndex,
} from "@razroo/iso-index";

const config = loadIndexConfig(JSON.parse(configText));
const index = buildIndex(config, { root: process.cwd() });
const matches = queryIndex(index, { text: "example labs" });
const alreadyApplied = hasIndexRecord(index, {
  key: "company-role:example-labs:staff-agent-engineer",
});
const verify = verifyIndex(index);
```

## Boundary

`iso-index` does not decide which source is authoritative for your domain. It
only builds and verifies a compact lookup layer from the sources you configure.
Domain packages still own freshness rules, source precedence, and workflow
decisions.

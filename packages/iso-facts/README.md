# @razroo/iso-facts

Deterministic fact materialization for AI-agent workflows.

`iso-facts` extracts structured, provenance-rich facts from local artifacts
without model calls. It is the layer between "where is the source file?"
(`iso-index`) and "is the downstream candidate record valid?" (`iso-contract`
/ `iso-preflight`).

## Install

```bash
npm install @razroo/iso-facts
```

## CLI

```bash
iso-facts build --config facts.json --root . --out .iso-facts.json
iso-facts query --facts .iso-facts.json --fact job.url
iso-facts has --facts .iso-facts.json --fact job.score
iso-facts verify --facts .iso-facts.json
iso-facts check --facts .iso-facts.json --config facts.json
iso-facts explain --config facts.json
```

## Config

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
          "fact": "job.url",
          "pattern": "^\\*\\*URL:\\*\\*\\s*(?<url>https?://\\S+)",
          "flags": "i",
          "key": "{url}",
          "value": "{url}",
          "fields": {
            "url": "{url}",
            "report": "{source}"
          },
          "tags": ["report", "url"]
        }
      ]
    }
  ],
  "requirements": [
    { "fact": "job.url", "min": 1 }
  ]
}
```

Supported source formats:

- `text`: regex rules run line-by-line.
- `tsv`: rows become structured inputs; headers are read from the first row by default.
- `markdown-table`: markdown rows become structured inputs.
- `jsonl`: each JSON object line becomes a structured input.
- `json`: each configured `path` selects one or more structured inputs.

Template fields support `{field}` placeholders and filters:

- `trim`
- `lower`
- `upper`
- `slug`
- `json`

Example: `{company|slug}:{role|slug}`.

## Fact Set

`build` writes a deterministic fact set:

```json
{
  "schemaVersion": 1,
  "root": "/repo",
  "configHash": "...",
  "stats": { "sources": 1, "files": 1, "facts": 1 },
  "facts": [
    {
      "schemaVersion": 1,
      "id": "...",
      "fact": "job.url",
      "key": "https://jobs.example.com/staff-ai-engineer",
      "value": "https://jobs.example.com/staff-ai-engineer",
      "source": {
        "name": "reports",
        "path": "reports/001-example.md",
        "line": 3
      },
      "fields": {
        "url": "https://jobs.example.com/staff-ai-engineer"
      },
      "tags": ["report", "url"]
    }
  ]
}
```

Findings preserve source path and line, so downstream agents can load only the
authoritative source span instead of rereading broad artifact trees.

## Library

```ts
import {
  buildFacts,
  checkFactRequirements,
  hasFact,
  loadFactsConfig,
  queryFacts,
  verifyFactSet,
} from "@razroo/iso-facts";

const config = loadFactsConfig(JSON.parse(await fs.readFile("facts.json", "utf8")));
const factSet = buildFacts(config, { root: process.cwd() });

if (hasFact(factSet, { fact: "job.url" })) {
  console.log(queryFacts(factSet, { fact: "job.url" }));
}

console.log(verifyFactSet(factSet));
console.log(checkFactRequirements(factSet, config.requirements));
```

## Boundaries

`iso-facts` does not decide source precedence, identity matching, artifact
shape, dispatch safety, or retention policy.

- Use `iso-index` to find compact source pointers.
- Use `iso-canon` for identity keys and comparisons.
- Use `iso-contract` for record validation/rendering.
- Use `iso-preflight` to turn materialized facts into safe dispatch plans.
- Use `iso-redact` before exporting fact inputs or fact sets that may contain
  sensitive data.

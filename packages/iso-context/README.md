# @razroo/iso-context

**Deterministic context bundles for AI-agent workflows.**

Agents often burn tokens because the question "which files should this role
load?" lives in prose. `iso-context` moves context selection into local JSON
policy: resolve bundle inheritance, read the declared files, estimate tokens,
check per-file and per-bundle budgets, and render a compact context pack
without model calls.

It is local-only, dependency-free, and MCP-free. Use it for mode runbooks,
reference files, project facts, or any other context set where "load only
these files for this task" should be executable policy instead of repeated
prompt instructions.

## Install

```bash
npm install -D @razroo/iso-context
```

## CLI

```bash
iso-context list --policy context.json
iso-context explain apply --policy context.json

iso-context plan apply \
  --policy context.json \
  --root /path/to/project

iso-context check apply \
  --policy context.json \
  --root /path/to/project \
  --budget 12000

iso-context render apply \
  --policy context.json \
  --root /path/to/project \
  --target markdown
```

Every command accepts `--json` for machine-readable output.

## Policy Shape

```json
{
  "defaults": {
    "tokenBudget": 9000,
    "charsPerToken": 4
  },
  "bundles": [
    {
      "name": "base",
      "description": "Always-loaded workflow contract.",
      "files": [
        { "path": "iso/instructions.md", "maxTokens": 3500 }
      ]
    },
    {
      "name": "apply",
      "extends": "base",
      "description": "Application form-fill context.",
      "tokenBudget": 12000,
      "files": [
        "modes/apply.md",
        "modes/reference-geometra.md",
        { "path": "modes/reference-portals.md", "required": false }
      ]
    }
  ]
}
```

Accepted top-level input can be `{ "bundles": [...] }`, an array of bundles,
or one bundle object.

## Semantics

- `extends` supports one parent or an array of parents.
- Parent files and notes are inherited before child values.
- Re-declaring the same file path in a child overrides scalar file fields while
  preserving the original file order.
- `required` defaults to `true`; missing optional files do not fail checks.
- `tokenBudget` may be set globally or per bundle.
- `maxTokens` may be set per file.
- Token estimates are deterministic and local: `ceil(characters / charsPerToken)`,
  with `charsPerToken` defaulting to `4`.

## Library API

```ts
import {
  loadContextPolicy,
  planContext,
  renderContextPlan,
} from "@razroo/iso-context";

const policy = loadContextPolicy(JSON.parse(rawPolicy));
const plan = planContext(policy, "apply", {
  root: process.cwd(),
  includeContent: true,
});

if (!plan.ok) process.exit(1);
console.log(renderContextPlan(plan, "markdown"));
```

## Fit With The iso Stack

- `iso-context` defines which files should enter context for a task.
- `isolint` makes the prose inside those files safer for smaller models.
- `iso-harness` emits the harness files where those contexts are referenced.
- `iso-route` defines which model a role should use.
- `iso-capabilities` defines what a role may do.
- `iso-contract` defines artifact shape.
- `iso-ledger` records domain events about those artifacts.
- `iso-guard` audits whether the actual run obeyed policy.

For JobForge, context bundles can represent the difference between `apply`,
`scan`, `batch`, and `tracker` mode loads without repeatedly telling every
agent to remember the full context-loading matrix.

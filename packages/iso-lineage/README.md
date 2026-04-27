# @razroo/iso-lineage

Deterministic artifact lineage and stale-output detection for AI-agent workflows.

`iso-lineage` records the exact file hashes used to create an artifact, then checks whether that artifact or any of its inputs have changed. It also propagates stale state through generated artifacts, so a PDF depending on a stale report is stale even when the PDF bytes have not changed.

## Why

Agent systems generate many local artifacts:

- reports from CV/profile/JD inputs
- PDFs from generated CV markdown
- preflight plans from facts, scores, timelines, and priority queues
- cached/indexed views from source files

This package answers "can this output still be trusted?" without asking a model to reread the project.

## CLI

```bash
iso-lineage record \
  --graph .iso-lineage.json \
  --artifact reports/812-example-labs.md \
  --input cv.md \
  --input profile.yml \
  --input jobs/example-labs.md \
  --command "job-forge evaluate jobs/example-labs.md"

iso-lineage record \
  --graph .iso-lineage.json \
  --artifact generated/812-example-labs.pdf \
  --input reports/812-example-labs.md \
  --command "job-forge pdf reports/812-example-labs.md"

iso-lineage verify --graph .iso-lineage.json
iso-lineage check --graph .iso-lineage.json
iso-lineage stale --graph .iso-lineage.json
iso-lineage explain --graph .iso-lineage.json --artifact reports/812-example-labs.md
```

## Library

```ts
import {
  checkLineage,
  emptyLineageGraph,
  recordLineage,
  verifyLineageGraph,
} from "@razroo/iso-lineage";

let graph = emptyLineageGraph();
graph = recordLineage(graph, {
  root: process.cwd(),
  artifact: "reports/812-example-labs.md",
  inputs: ["cv.md", "profile.yml", "jobs/example-labs.md"],
  command: "job-forge evaluate jobs/example-labs.md",
});

const check = checkLineage(graph);
const verify = verifyLineageGraph(graph);
```

## Design Notes

- No MCP server.
- No model calls.
- No prompt/tool-schema tokens unless you paste output into a prompt.
- Graph IDs and record IDs are content hashes.
- Records are keyed by artifact path and upserted deterministically.
- Optional inputs can be recorded as missing; if they appear later, dependent artifacts become stale.

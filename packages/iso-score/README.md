# @razroo/iso-score

Deterministic weighted rubric scoring for AI-agent workflows.

`iso-score` turns structured dimension scores into a local, verifiable score
artifact. It owns the arithmetic, bands, gate decisions, result ids, and
integrity checks. Domain packages still own the rubric and the evidence.

## Install

```bash
npm install @razroo/iso-score
```

## CLI

```bash
iso-score compute --config score.json --input evaluation.json --out score-result.json
iso-score verify --score score-result.json
iso-score check --config score.json --input evaluation.json
iso-score gate --config score.json --input evaluation.json --gate apply
iso-score compare --config score.json --left evaluation.json --right evaluation-alt.json
iso-score explain --config score.json
```

## Config

```json
{
  "version": 1,
  "profiles": [
    {
      "name": "jobfit",
      "scale": { "min": 0, "max": 5, "precision": 2 },
      "dimensions": [
        { "id": "role_fit", "label": "Role fit", "weight": 0.35, "required": true, "minEvidence": 1 },
        { "id": "company_fit", "label": "Company fit", "weight": 0.2, "required": true, "minEvidence": 1 },
        { "id": "comp", "label": "Compensation", "weight": 0.15 }
      ],
      "bands": [
        { "id": "strong", "label": "Strong", "min": 4 },
        { "id": "apply", "label": "Apply", "min": 3 },
        { "id": "skip", "label": "Skip", "min": 0 }
      ],
      "gates": [
        { "id": "apply", "min": 3, "blockOnMissingRequired": true, "blockOnIssues": true }
      ]
    }
  ]
}
```

## Input

```json
{
  "subject": "Example Labs Staff Agent Engineer",
  "profile": "jobfit",
  "dimensions": {
    "role_fit": {
      "score": 4.5,
      "evidence": ["reports/812-example-labs.md:12"]
    },
    "company_fit": {
      "score": 4,
      "evidence": ["reports/812-example-labs.md:18"]
    },
    "comp": {
      "score": 3.5,
      "evidence": ["reports/812-example-labs.md:23"]
    }
  }
}
```

## Result

`compute` writes a deterministic result with a content-derived id:

```json
{
  "schemaVersion": 1,
  "id": "score:...",
  "profile": "jobfit",
  "subject": "Example Labs Staff Agent Engineer",
  "minScore": 0,
  "maxScore": 5,
  "score": 4.05,
  "normalized": 0.81,
  "band": { "id": "apply", "label": "Apply", "min": 3 },
  "dimensions": [],
  "gates": [
    { "id": "apply", "label": "apply", "pass": true, "reason": "score 4.05 >= 3" }
  ],
  "issues": []
}
```

The score is computed from normalized dimension scores and normalized weights.
Missing optional dimensions are ignored. Missing required dimensions or required
evidence produce error issues, and gates can fail closed on those issues.

## Library

```ts
import {
  checkScore,
  computeScore,
  evaluateGate,
  loadScoreConfig,
  verifyScoreResult,
} from "@razroo/iso-score";

const config = loadScoreConfig(JSON.parse(await fs.readFile("score.json", "utf8")));
const input = JSON.parse(await fs.readFile("evaluation.json", "utf8"));

const result = computeScore(config, input);
console.log(result.score, result.band, result.gates);
console.log(checkScore(config, input));
console.log(evaluateGate(config, input, { gate: "apply" }));
console.log(verifyScoreResult(result));
```

## Boundaries

`iso-score` does not decide whether a score is true, fair, fresh, or complete.
It makes local scoring math deterministic after a domain package has already
selected source-backed inputs.

- Use `iso-facts` to materialize evidence-backed values.
- Use `iso-contract` to validate the shape of scoring inputs/results.
- Use `iso-preflight` to consume gate output before dispatch.
- Use `iso-ledger` to record score events as operational truth.
- Use `iso-guard` to audit whether scored gates were followed in real runs.

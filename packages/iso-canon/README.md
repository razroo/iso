# @razroo/iso-canon

Deterministic canonicalization and entity matching for AI-agent workflows.

`iso-canon` answers: **what stable key represents this URL, company, role,
or company-role pair?** It normalizes common workflow identifiers and compares
them without model calls, MCP servers, or prompt-token-heavy duplicate rules.

It is:

- **Deterministic**: the same input and profile always produce the same key.
- **Explainable**: comparisons return a verdict, score, and reasons.
- **Domain-neutral**: JobForge examples are included, but the package only knows URL/text canonicalization profiles.

## Install

```bash
npm install @razroo/iso-canon
```

## CLI

```bash
iso-canon normalize url "https://www.example.com/jobs/123?utm_source=x"
iso-canon normalize company "OpenAI, Inc."
iso-canon key company-role --company "Anthropic, PBC" --role "Senior SWE - Remote US"
iso-canon compare company "OpenAI, Inc." "Open AI" --config examples/jobforge-canon.json --profile jobforge
iso-canon explain --config examples/jobforge-canon.json --profile jobforge
```

`compare` prints `same`, `possible`, or `different`. It exits `0` for all
valid comparisons so callers can decide how strict to be.

## JobForge-Style Example

```bash
iso-canon key company-role \
  --company "Anthropic, PBC" \
  --role "Senior SWE, AI Platform - Remote US" \
  --config examples/jobforge-canon.json \
  --profile jobforge
```

Output:

```text
company-role:anthropic:senior-software-engineer-ai-platform
```

## Config Shape

```json
{
  "version": 1,
  "profiles": [
    {
      "name": "jobforge",
      "url": {
        "dropHash": true,
        "stripQueryParams": ["utm_*", "gh_src", "source"]
      },
      "company": {
        "aliases": {
          "open ai": "openai"
        },
        "suffixes": ["inc", "llc", "pbc"]
      },
      "role": {
        "aliases": {
          "swe": "software engineer"
        },
        "stopWords": ["remote", "us", "united states"]
      },
      "match": {
        "strong": 0.92,
        "possible": 0.78
      }
    }
  ]
}
```

Profiles extend built-in defaults, so you only need to declare domain-specific
aliases, suffixes, stop words, and thresholds.

## Library

```ts
import {
  canonicalizeCompanyRole,
  compareCanon,
  loadCanonConfig,
  resolveProfile,
} from "@razroo/iso-canon";

const config = loadCanonConfig(JSON.parse(configText));
const profile = resolveProfile(config, "jobforge");
const key = canonicalizeCompanyRole("OpenAI, Inc.", "Senior SWE - Remote US", profile).key;
const duplicate = compareCanon("company", "OpenAI, Inc.", "Open AI", profile);
```

## Boundary

`iso-canon` does not decide which source of truth wins and does not mutate
trackers, ledgers, indexes, or caches. Domain packages own source precedence
and decide whether a `possible` match should block work, warn, or route to a
human review step.

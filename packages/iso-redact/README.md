# @razroo/iso-redact

`iso-redact` is a deterministic local redaction engine for agent workflows.
It scans text for sensitive values, applies replacement strings, verifies
that output is clean, and explains the active policy without model calls,
MCP servers, or prompt-token overhead.

Use it anywhere a workflow exports traces, telemetry, eval fixtures, logs,
or human-readable summaries that might contain credentials or personal data.

## Install

```bash
npm install @razroo/iso-redact
```

## CLI

```bash
iso-redact scan --config redact.json --input session.jsonl
iso-redact verify --config redact.json --input exported-fixture/task.md
iso-redact apply --config redact.json --input raw.txt --output safe.txt
iso-redact explain --config redact.json
```

`verify` exits `1` when sensitive values are still present. `scan` reports
findings but exits successfully. `apply` writes redacted text to `--output`
or stdout.

## Policy

```json
{
  "version": 1,
  "defaults": {
    "severity": "error",
    "replacement": "[REDACTED:{id}]"
  },
  "builtins": [
    "email",
    "phone",
    "openai-api-key",
    "github-token",
    "npm-token",
    "aws-access-key-id",
    "bearer-token",
    "private-key",
    "proxy-url-credentials"
  ],
  "fields": [
    {
      "id": "proxy-config",
      "names": ["server", "username", "password", "bypass"]
    }
  ],
  "patterns": [
    {
      "id": "internal-ticket",
      "pattern": "\\bSEC-[0-9]{4,}\\b",
      "flags": "g",
      "severity": "warn"
    }
  ]
}
```

Builtins are curated regex detectors. `fields` redact values assigned to
named JSON/YAML/env-style fields while preserving the key and surrounding
syntax. `patterns` are user-provided regular expressions. Replacement
templates may include `{id}`.

## Library

```ts
import { loadRedactConfig, redactText, scanText } from "@razroo/iso-redact";

const config = loadRedactConfig(policyJson);
const scan = scanText(config, "token=sk-proj-...", { source: "trace.jsonl" });
const safe = redactText(config, "token=sk-proj-...").text;
```

Findings intentionally do not include the original sensitive value. They
include source, line, column, rule id, severity, match length, and the
replacement that would be applied.

## Builtins

- `email`
- `phone`
- `openai-api-key`
- `github-token`
- `npm-token`
- `aws-access-key-id`
- `bearer-token`
- `private-key`
- `proxy-url-credentials`

## Composition

- `iso-trace` can call `iso-redact` before exporting sessions or fixtures.
- `iso-guard` can audit whether raw prompts/logs still contain secrets.
- `iso-eval` can sanitize exported regression fixtures before sharing.
- Domain harnesses can keep redaction policy in a local `redact.json` file
  instead of repeating secret-handling rules in prompt prose.

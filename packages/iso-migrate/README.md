# @razroo/iso-migrate

Deterministic project migrations for AI-agent workflow packages.

`iso-migrate` answers: **what local project-owned files need to change for this
package upgrade?** It plans and applies idempotent JSON/text migrations without
model calls, MCP servers, shell-specific patch scripts, or a mandatory migration
history database.

It is:

- **Content-based**: a migration is complete when files already match the target state.
- **Dry-run first**: `plan` shows pending edits, `check` fails when drift remains.
- **Domain-neutral**: JobForge examples are included, but the package only knows files, JSON pointers, lines, replacements, and writes.

## Install

```bash
npm install @razroo/iso-migrate
```

## CLI

```bash
iso-migrate plan --config migrations.json --root .
iso-migrate apply --config migrations.json --root .
iso-migrate check --config migrations.json --root .
iso-migrate explain --config migrations.json
```

`check` exits `1` when changes are still pending, which makes it useful in CI.

## JobForge-Style Example

```bash
iso-migrate plan \
  --config examples/jobforge-consumer-migrations.json \
  --root /path/to/jobforge-consumer

iso-migrate apply \
  --config examples/jobforge-consumer-migrations.json \
  --root /path/to/jobforge-consumer
```

The bundled example adds `job-forge index:*` npm scripts, bumps a `job-forge`
dependency range, and ensures generated local state paths are ignored.

## Config Shape

```json
{
  "version": 1,
  "migrations": [
    {
      "id": "add-index",
      "description": "Add artifact-index commands.",
      "operations": [
        {
          "type": "json-merge",
          "path": "package.json",
          "pointer": "/scripts",
          "value": {
            "index:status": "job-forge index:status"
          }
        },
        {
          "type": "ensure-lines",
          "path": ".gitignore",
          "lines": [".jobforge-index.json"]
        }
      ]
    }
  ]
}
```

## Operations

- `json-set`: set a JSON pointer to a JSON value.
- `json-merge`: deep-merge an object at a JSON pointer.
- `ensure-lines`: ensure exact text lines exist, optionally near an `after` or `before` anchor.
- `replace`: replace exact text, once or globally.
- `write-file`: write a file, with optional overwrite protection.

All operation paths are relative to `--root`; absolute paths and path traversal
are rejected.

## Library

```ts
import {
  loadMigrationConfig,
  runMigrations,
} from "@razroo/iso-migrate";

const config = loadMigrationConfig(JSON.parse(configText));
const plan = runMigrations(config, { root: process.cwd(), dryRun: true });
if (plan.changed) {
  runMigrations(config, { root: process.cwd(), dryRun: false });
}
```

## Boundary

`iso-migrate` does not decide when a domain package should run migrations, and
it does not replace semantic versioning. Domain packages own migration ordering,
release policy, and any domain-specific validation after files change.

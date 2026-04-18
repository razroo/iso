# iso — monorepo

Workspaces monorepo (npm) housing three Razroo AI-harness tools:

- `packages/isolint` — `@razroo/isolint`. Lints / rewrites AI harness markdown for weak small models. TypeScript, compiled to `dist/` with `tsc`. Tests via `tsx --test test/*.test.ts`.
- `packages/agentmd` — `@razroo/agentmd`. Structured-markdown agent prompts + adherence harness. TypeScript, compiled to `dist/`. Tests via `node --test --import tsx tests/*.test.ts`.
- `packages/iso-harness` — `@razroo/iso-harness`. Plain ESM `.mjs` (no TS build). Transpiles a single iso config source into per-agent configs (Claude / Cursor / Codex / OpenCode).

## Conventions

- Each package owns its `package.json`, tests, README, LICENSE.
- TypeScript packages extend `../../tsconfig.base.json`.
- Package names stay on the `@razroo/*` scope so npm publish flows keep working.
- All packages are ESM (`"type": "module"`).
- Root `scripts` fan out via `npm run <x> --workspaces --if-present`.

## Cross-package dev

`agentmd` has a `lint:isolint` script that pipes its rendered prompts through `isolint`. When both are in the same workspace, prefer calling the sibling directly rather than the global binary.

## Do not

- Don't add `node_modules/`, `dist/`, or lockfiles from the former standalone repos. Only source + tests + examples + configs come over.
- Don't rename published package names — they're already live on npm.

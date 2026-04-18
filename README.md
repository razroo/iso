# iso

Monorepo for Razroo's AI harness tooling.

## Packages

- **[`packages/isolint`](./packages/isolint)** (`@razroo/isolint`) — Linter that rewrites AI harness markdown so weaker small models (Minimax, Nemotron, Mistral 7B) can execute it reliably.
- **[`packages/agentmd`](./packages/agentmd)** (`@razroo/agentmd`) — Agent prompts as structured markdown, with a linter for structure and a harness that scores per-rule adherence.
- **[`packages/iso-harness`](./packages/iso-harness)** (`@razroo/iso-harness`) — One config for every coding agent: Cursor, Claude Code, Codex, OpenCode.

## Layout

```
iso/
├── package.json          # workspaces root
├── tsconfig.base.json    # shared compiler options
└── packages/
    ├── isolint/
    ├── agentmd/
    └── iso-harness/
```

## Build & test

```bash
npm install                 # install all workspace deps
npm run build               # build every package
npm run test                # run every package's tests
npm run typecheck           # typecheck every package

# Target a single package
npm run build --workspace @razroo/isolint
npm run test  --workspace @razroo/agentmd
```

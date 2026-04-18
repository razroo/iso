<p align="center">
  <img src="./assets/logo.svg" alt="iso" width="320">
</p>

# iso

**Write your AI agent instructions once. Run them anywhere, on any model.**

`iso` is Razroo's toolchain for making agent harnesses *isomorphic* — the
same authored source produces the same agent behavior across every coding
harness (Cursor, Claude Code, Codex, OpenCode) and across every model tier
(frontier models down to 7B local models).

Today, writing agent instructions is fragmented on two axes:

1. **Harness fragmentation.** Each coding agent reads a different file
   layout — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`,
   `.opencode/agents/*.md`, `.mcp.json` vs `opencode.json` vs
   `.codex/config.toml`. Keeping them in sync is copy-paste drift.
2. **Model fragmentation.** A prompt written with a frontier model in mind
   quietly breaks on smaller models: soft imperatives (`should`,
   `when relevant`), taste words, ambiguous cross-references, and
   unstructured rationale all drop silently at 7B. You don't find out
   until the agent misbehaves in production.

The three packages in this repo compose into a pipeline that fixes both:

```
   authored source              structural dialect             portable prose             fan-out to harnesses
  ┌────────────────┐  agentmd  ┌──────────────────┐  isolint  ┌───────────────┐  iso-harness  ┌──────────────────┐
  │ your agent .md │ ────────▶ │ validated rules, │ ────────▶ │ small-model-  │ ─────────────▶│ CLAUDE.md        │
  │ + fixtures     │   lint    │ scope labels,    │ lint/fix  │ safe prose    │    build      │ AGENTS.md        │
  │                │  render   │ load-bearing why │           │               │               │ .cursor/rules/*  │
  └────────────────┘           └──────────────────┘           └───────────────┘               │ .opencode/*      │
                                                                                              └──────────────────┘
```

## Packages

- **[`packages/agentmd`](./packages/agentmd)** — [`@razroo/agentmd`](https://www.npmjs.com/package/@razroo/agentmd)
  A structured-markdown dialect for agent prompts. Rules are scoped
  (`[H1]` hard limit, `[D1]` default) with load-bearing `why:` rationale.
  Ships a linter for structure (missing rationale, dangling refs, no
  fallback row) and a fixture-driven harness that measures per-rule
  adherence against the target model.

- **[`packages/isolint`](./packages/isolint)** — [`@razroo/isolint`](https://www.npmjs.com/package/@razroo/isolint)
  Lints the compiled prose for phrases weak small models can't parse —
  `should`, `when relevant`, `one of the usual categories`, taste words,
  long sentences, unclosed `etc.` lists. `--fix --llm` rewrites offenders
  and re-lints the rewrite before accepting. Also ships an Isomorphic
  Plan engine for fully-deterministic large-model-plans → small-model-run
  pipelines.

- **[`packages/iso-harness`](./packages/iso-harness)** — [`@razroo/iso-harness`](https://www.npmjs.com/package/@razroo/iso-harness)
  One `iso/` source directory → the file layout each coding agent
  actually reads. Transpiles instructions, subagents, slash commands, and
  MCP servers into `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`,
  `.opencode/agents/*.md`, etc., so all four harnesses stay in lockstep.

Each package is independently published on npm and works on its own.
They're in one repo because they're designed to compose.

## Layout

```
iso/
├── package.json          # workspaces root
├── tsconfig.base.json    # shared compiler options
└── packages/
    ├── agentmd/          # structure + adherence
    ├── isolint/          # portable prose
    └── iso-harness/      # one source, every harness
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

# @razroo/iso-capabilities

**Deterministic role capability policies for agent workflows.**

Agents often receive broad tool access because capability boundaries live
in prose. `iso-capabilities` moves those boundaries into local JSON policy:
resolve role inheritance, check requested tool/MCP/command/filesystem/network
access, and render compact target-specific guidance without model calls.

It is local-only, dependency-free, and MCP-free. Use it for roles such as
orchestrators, browser subagents, verifiers, reviewers, or any other agent
shape where "what this role may do" should be executable policy instead of
prompt text.

## Install

```bash
npm install -D @razroo/iso-capabilities
```

## CLI

```bash
iso-capabilities list --policy capabilities.json
iso-capabilities explain applicant --policy capabilities.json

iso-capabilities check applicant \
  --policy capabilities.json \
  --tool browser \
  --mcp geometra \
  --command "npx job-forge merge" \
  --filesystem write \
  --network restricted

iso-capabilities render applicant \
  --policy capabilities.json \
  --target opencode
```

Every command accepts `--json` for machine-readable output.

## Policy Shape

```json
{
  "roles": [
    {
      "name": "base",
      "description": "Reads local state and runs safe verification commands.",
      "tools": ["read", "search", "shell"],
      "mcp": [],
      "commands": {
        "allow": ["npx job-forge verify", "rg *"],
        "deny": ["geometra_*", "rm -rf *"]
      },
      "filesystem": "read-only",
      "network": "off"
    },
    {
      "name": "applicant",
      "extends": "base",
      "tools": ["browser", "write"],
      "mcp": ["geometra", "gmail"],
      "filesystem": "project-write",
      "network": "restricted"
    }
  ]
}
```

Accepted top-level input can be `{ "roles": [...] }`, an array of roles,
or one role object.

## Semantics

- `extends` supports one parent or an array of parents.
- Parent tools, MCP servers, command allowlists, command denylists, and notes
  are inherited before child values.
- Child `filesystem`, `network`, and `description` values override inherited
  values.
- `commands.deny` wins before `commands.allow`.
- Command patterns support exact strings and trailing `*` prefix matches.
- Tool and MCP lists support `*` as an allow-all entry.

Filesystem modes:

- `none`
- `read-only`
- `project-write`
- `workspace-write`
- `unrestricted`

Network modes:

- `off`
- `restricted`
- `on`

## Library API

```ts
import {
  checkRoleCapability,
  loadCapabilityPolicy,
  resolveRole,
} from "@razroo/iso-capabilities";

const policy = loadCapabilityPolicy(JSON.parse(rawPolicy));
const applicant = resolveRole(policy, "applicant");
const result = checkRoleCapability(policy, "applicant", {
  tools: ["browser"],
  mcp: ["geometra"],
  commands: ["npx job-forge merge"],
  filesystem: ["write"],
  network: "restricted",
});
```

## Fit With The iso Stack

- `iso-capabilities` defines what a role may do.
- `iso-route` defines which model a role should use.
- `iso-harness` emits the harness files where roles run.
- `iso-contract` defines artifact shape.
- `iso-ledger` records domain events about those artifacts.
- `iso-orchestrator` controls durable workflow execution.
- `iso-guard` audits whether the actual run obeyed policy.

For JobForge, capabilities can represent the difference between an inline
orchestrator, a browser application subagent, and a verifier without loading
the full permission matrix into every prompt turn.

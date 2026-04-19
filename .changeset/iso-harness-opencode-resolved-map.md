---
"@razroo/iso-harness": minor
---

OpenCode emitter falls back to iso-route's resolved map for model
frontmatter — mirrors the Claude emitter's behavior.

When an agent source file has no inline `targets.opencode.model` (and
no top-level `model:`), the OpenCode emitter now reads
`opencode.json`'s `agent.<roleName>.model` field (written by
`@razroo/iso-route` before iso-harness runs) and stamps that onto the
generated `.opencode/agents/<slug>.md` frontmatter.

Resolution order on the OpenCode target now matches Claude Code:
`targets.opencode.model` (inline on the iso agent) → top-level
`model:` → iso-route's resolved map → nothing. Agents that hard-pin a
model continue to own that decision; agents that delegate model choice
to `models.yaml` no longer need their inline override duplicated.

Behavior when iso-route hasn't run (no prior `opencode.json`) is
unchanged — no model is stamped unless the agent source provides one.

Also collapses a duplicate `opencode.json` read inside `emitOpenCode`:
the file is now loaded once at the top and reused for both the agent
lookup and the later merge-write.

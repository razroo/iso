import path from 'node:path';
import { stringify as toFrontmatter } from '../frontmatter.mjs';
import { writeFile, writeJson } from '../fs-utils.mjs';
import { targetOverride } from '../source.mjs';

export async function emitCursor(src, outDir, opts = {}) {
  const written = [];
  const push = async (p, content, writer = writeFile) => {
    const { bytes } = await writer(p, content, opts);
    written.push({ path: p, bytes });
  };

  if (src.instructions) {
    const data = {
      description: 'Project instructions',
      alwaysApply: true,
    };
    const p = path.join(outDir, '.cursor', 'rules', 'main.mdc');
    await push(p, toFrontmatter({ data, body: src.instructions }));
  }

  // Cursor has no native subagents or slash commands; emit agent prompts as
  // optional (non-always) rules so users can @-reference them in chat.
  for (const agent of src.agents) {
    const { skip, override } = targetOverride(agent, 'cursor');
    if (skip) continue;
    const data = {
      description: override.description ?? agent.description ?? `${agent.name} agent prompt`,
      alwaysApply: false,
    };
    const p = path.join(outDir, '.cursor', 'rules', `agent-${agent.slug}.mdc`);
    await push(p, toFrontmatter({ data, body: agent.body }));
  }

  if (Object.keys(src.mcp.servers).length > 0) {
    const mcpServers = {};
    for (const [name, def] of Object.entries(src.mcp.servers)) {
      const entry = { command: def.command };
      if (def.args) entry.args = def.args;
      if (def.env) entry.env = def.env;
      mcpServers[name] = entry;
    }
    const p = path.join(outDir, '.cursor', 'mcp.json');
    await push(p, { mcpServers }, writeJson);
  }

  return written;
}

import path from 'node:path';
import { stringify as toFrontmatter } from '../frontmatter.mjs';
import { writeFile, writeJson } from '../fs-utils.mjs';
import { targetOverride } from '../source.mjs';

function claudeTools(tools) {
  if (!tools) return undefined;
  if (Array.isArray(tools)) return tools.join(', ');
  return String(tools);
}

export async function emitClaude(src, outDir, opts = {}) {
  const written = [];
  const push = async (p, content, writer = writeFile) => {
    const { bytes } = await writer(p, content, opts);
    written.push({ path: p, bytes });
  };

  if (src.instructions) {
    const p = path.join(outDir, 'CLAUDE.md');
    await push(p, src.instructions.endsWith('\n') ? src.instructions : src.instructions + '\n');
  }

  for (const agent of src.agents) {
    const { skip, override } = targetOverride(agent, 'claude');
    if (skip) continue;
    const data = {
      name: agent.name,
      description: agent.description,
    };
    const tools = claudeTools(override.tools ?? agent.tools);
    if (tools) data.tools = tools;
    const model = override.model ?? agent.model;
    if (model) data.model = model;
    const p = path.join(outDir, '.claude', 'agents', `${agent.slug}.md`);
    await push(p, toFrontmatter({ data, body: agent.body }));
  }

  for (const cmd of src.commands) {
    const { skip, override } = targetOverride(cmd, 'claude');
    if (skip) continue;
    const data = {};
    if (cmd.description) data.description = cmd.description;
    const argHint = override['argument-hint'] ?? cmd.extra?.['argument-hint'] ?? cmd.extra?.args;
    if (argHint) data['argument-hint'] = Array.isArray(argHint) ? argHint.join(' ') : argHint;
    const allowed = override['allowed-tools'] ?? cmd.extra?.['allowed-tools'];
    if (allowed) data['allowed-tools'] = claudeTools(allowed);
    const model = override.model ?? cmd.model;
    if (model) data.model = model;
    const p = path.join(outDir, '.claude', 'commands', `${cmd.slug}.md`);
    await push(p, toFrontmatter({ data, body: cmd.body }));
  }

  if (Object.keys(src.mcp.servers).length > 0) {
    const mcpServers = {};
    for (const [name, def] of Object.entries(src.mcp.servers)) {
      const entry = { command: def.command };
      if (def.args) entry.args = def.args;
      if (def.env) entry.env = def.env;
      mcpServers[name] = entry;
    }
    const p = path.join(outDir, '.mcp.json');
    await push(p, { mcpServers }, writeJson);
  }

  return written;
}

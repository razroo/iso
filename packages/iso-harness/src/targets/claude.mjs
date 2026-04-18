import path from 'node:path';
import { stringify as toFrontmatter } from '../frontmatter.mjs';
import { writeFile, writeJson } from '../fs-utils.mjs';
import { targetOverride } from '../source.mjs';

function claudeTools(tools) {
  if (!tools) return undefined;
  if (Array.isArray(tools)) return tools.join(', ');
  return String(tools);
}

export async function emitClaude(src, outDir) {
  const written = [];

  if (src.instructions) {
    const p = path.join(outDir, 'CLAUDE.md');
    await writeFile(p, src.instructions.endsWith('\n') ? src.instructions : src.instructions + '\n');
    written.push(p);
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
    await writeFile(p, toFrontmatter({ data, body: agent.body }));
    written.push(p);
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
    await writeFile(p, toFrontmatter({ data, body: cmd.body }));
    written.push(p);
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
    await writeJson(p, { mcpServers });
    written.push(p);
  }

  return written;
}

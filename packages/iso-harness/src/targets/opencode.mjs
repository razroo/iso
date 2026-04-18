import path from 'node:path';
import { stringify as toFrontmatter } from '../frontmatter.mjs';
import { writeFile, writeJson } from '../fs-utils.mjs';
import { targetOverride } from '../source.mjs';

export async function emitOpenCode(src, outDir, opts = {}) {
  const written = [];
  const push = async (p, content, writer = writeFile) => {
    const { bytes } = await writer(p, content, opts);
    written.push({ path: p, bytes });
  };

  if (src.instructions) {
    const p = path.join(outDir, 'AGENTS.md');
    await push(p, src.instructions.endsWith('\n') ? src.instructions : src.instructions + '\n');
  }

  for (const agent of src.agents) {
    const { skip, override } = targetOverride(agent, 'opencode');
    if (skip) continue;
    const data = {
      description: override.description ?? agent.description,
      mode: override.mode ?? 'subagent',
    };
    const model = override.model ?? agent.model;
    if (model) data.model = model;
    // OpenCode wants tools as an object map; only emit if override provided
    // (array form is harness-agnostic and doesn't translate cleanly).
    if (override.tools && !Array.isArray(override.tools)) {
      data.tools = override.tools;
    }
    // Pass through any opencode-specific frontmatter (temperature,
    // reasoningEffort, fallback_models, etc.) via the override.
    for (const [k, v] of Object.entries(override)) {
      if (['description', 'mode', 'model', 'tools'].includes(k)) continue;
      data[k] = v;
    }
    const p = path.join(outDir, '.opencode', 'agents', `${agent.slug}.md`);
    await push(p, toFrontmatter({ data, body: agent.body }));
  }

  for (const cmd of src.commands) {
    const { skip, override } = targetOverride(cmd, 'opencode');
    if (skip) continue;
    const data = {
      name: override.name ?? cmd.name,
      description: override.description ?? cmd.description,
    };
    const userInvocable = override.user_invocable ?? cmd.extra?.user_invocable ?? true;
    data.user_invocable = userInvocable;
    const args = override.args ?? cmd.extra?.args ?? cmd.extra?.['argument-hint'];
    if (args) data.args = Array.isArray(args) ? args.join(' ') : args;
    const p = path.join(outDir, '.opencode', 'skills', `${cmd.slug}.md`);
    await push(p, toFrontmatter({ data, body: cmd.body }));
  }

  const opencodeExtras = src.config?.targets?.opencode ?? {};
  const hasMcp = Object.keys(src.mcp.servers).length > 0;
  const hasExtras = Object.keys(opencodeExtras).length > 0;
  if (hasMcp || hasExtras) {
    const output = {
      $schema: 'https://opencode.ai/config.json',
    };
    if (hasMcp) {
      const mcp = {};
      for (const [name, def] of Object.entries(src.mcp.servers)) {
        const command = [def.command, ...(def.args ?? [])];
        mcp[name] = {
          type: 'local',
          command,
          environment: def.env ?? {},
        };
      }
      output.mcp = mcp;
    }
    for (const [k, v] of Object.entries(opencodeExtras)) {
      output[k] = v;
    }
    const p = path.join(outDir, 'opencode.json');
    await push(p, output, writeJson);
  }

  return written;
}

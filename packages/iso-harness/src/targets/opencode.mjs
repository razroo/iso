import path from 'node:path';
import { promises as fs } from 'node:fs';
import { stringify as toFrontmatter } from '../frontmatter.mjs';
import { writeFile, writeJson } from '../fs-utils.mjs';
import { targetOverride } from '../source.mjs';

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

// Resolve a model for an OpenCode subagent from iso-route's opencode.json.
// iso-route writes `agent.<roleName>.model` as a fully-qualified routing
// token (e.g. "anthropic/claude-haiku-4-5", "opencode/big-pickle"). Return
// null when no value is recorded for this role so the caller can decide
// whether to fall through to no-model or surface a warning.
function modelFromOpenCodeConfig(cfg, roleName) {
  const entry = cfg?.agent?.[roleName];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.model !== 'string' || !entry.model) return null;
  return { model: entry.model };
}

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

  // Load iso-route's opencode.json once so we can (a) fall back to its
  // per-agent `model:` when no inline model is declared on an iso source
  // agent, and (b) preserve its routing fields when later writing the
  // merged config. A single read avoids racing the per-agent file writes
  // below with the later merge-write on opencode.json.
  const opencodeJsonPath = path.join(outDir, 'opencode.json');
  const existingConfig = opts.dryRun ? {} : await readJsonIfExists(opencodeJsonPath);

  for (const agent of src.agents) {
    const { skip, override } = targetOverride(agent, 'opencode');
    if (skip) continue;
    const data = {
      description: override.description ?? agent.description,
      mode: override.mode ?? 'subagent',
    };
    let model = override.model ?? agent.model;
    // Only consult iso-route's opencode.json when no inline model is
    // declared — an agent author that hard-pinned a model owns that
    // decision (same resolution order as the Claude emitter).
    if (!model) {
      const roleName = agent.role ?? agent.slug;
      const lookup = modelFromOpenCodeConfig(existingConfig, roleName);
      if (lookup?.model) model = lookup.model;
    }
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
    // Reuse the `existingConfig` loaded at the top — re-reading could race
    // with intermediate per-agent file writes on slower filesystems and is
    // wasted I/O. `@razroo/iso-route` writes model routing fields to
    // opencode.json; iso-harness must preserve them and layer its own
    // mcp/extras on top rather than overwriting.
    const output = {
      ...existingConfig,
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
    await push(opencodeJsonPath, output, writeJson);
  }

  return written;
}

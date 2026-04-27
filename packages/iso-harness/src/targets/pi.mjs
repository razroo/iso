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
    throw new Error(`iso-harness: failed to read ${p}: ${err.message}`);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeSettings(base, overlay) {
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (isPlainObject(out[k]) && isPlainObject(v)) {
      out[k] = mergeSettings(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function spaceList(v) {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}

function copyExtras(data, override, reserved) {
  for (const [k, v] of Object.entries(override)) {
    if (reserved.has(k)) continue;
    data[k] = v;
  }
}

export async function emitPi(src, outDir, opts = {}) {
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
    const { skip, override } = targetOverride(agent, 'pi');
    if (skip) continue;
    const skillName = override.name ?? agent.slug;
    const data = {
      name: skillName,
      description: override.description ?? agent.description,
    };
    const allowedTools = override['allowed-tools'] ?? override.allowedTools;
    if (allowedTools) data['allowed-tools'] = spaceList(allowedTools);
    copyExtras(
      data,
      override,
      new Set(['name', 'description', 'allowed-tools', 'allowedTools', 'model', 'tools', 'role']),
    );
    const p = path.join(outDir, '.pi', 'skills', skillName, 'SKILL.md');
    await push(p, toFrontmatter({ data, body: agent.body }));
  }

  for (const cmd of src.commands) {
    const { skip, override } = targetOverride(cmd, 'pi');
    if (skip) continue;
    const promptName = override.name ?? cmd.slug;
    const data = {};
    const description = override.description ?? cmd.description;
    if (description) data.description = description;
    const argHint =
      override['argument-hint'] ??
      override.args ??
      cmd.extra?.['argument-hint'] ??
      cmd.extra?.args;
    if (argHint) data['argument-hint'] = Array.isArray(argHint) ? argHint.join(' ') : argHint;
    copyExtras(data, override, new Set(['name', 'description', 'argument-hint', 'args', 'model', 'tools']));
    const p = path.join(outDir, '.pi', 'prompts', `${promptName}.md`);
    await push(p, toFrontmatter({ data, body: cmd.body }));
  }

  const piExtras = src.config?.targets?.pi;
  if (isPlainObject(piExtras) && Object.keys(piExtras).length > 0) {
    const settingsPath = path.join(outDir, '.pi', 'settings.json');
    const existing = opts.dryRun ? {} : await readJsonIfExists(settingsPath);
    await push(settingsPath, mergeSettings(existing, piExtras), writeJson);
  }

  return written;
}

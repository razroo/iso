import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseFrontmatter } from './frontmatter.mjs';

async function readIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readDirEntries(dir) {
  try {
    const names = await fs.readdir(dir);
    return names.filter(n => n.endsWith('.md') && !n.startsWith('_'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function loadMarkdownDir(dir) {
  const files = await readDirEntries(dir);
  const out = [];
  for (const name of files.sort()) {
    const full = path.join(dir, name);
    const raw = await fs.readFile(full, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const slug = name.replace(/\.md$/, '');
    out.push({
      slug,
      name: data.name ?? slug,
      description: data.description ?? '',
      model: data.model,
      tools: data.tools,
      targets: data.targets ?? {},
      extra: data,
      body: body.trimStart(),
    });
  }
  return out;
}

export async function loadSource(sourceDir) {
  const abs = path.resolve(sourceDir);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Source directory not found: ${abs}`);
  }

  const instructions = await readIfExists(path.join(abs, 'instructions.md'));
  const mcpRaw = await readIfExists(path.join(abs, 'mcp.json'));
  const configRaw = await readIfExists(path.join(abs, 'config.json'));

  let mcp = { servers: {} };
  if (mcpRaw) {
    try {
      mcp = JSON.parse(mcpRaw);
    } catch (err) {
      throw new Error(`Invalid iso/mcp.json: ${err.message}`);
    }
    if (!mcp.servers || typeof mcp.servers !== 'object') {
      throw new Error(`iso/mcp.json must have a top-level "servers" object`);
    }
  }

  let config = {};
  if (configRaw) {
    try {
      config = JSON.parse(configRaw);
    } catch (err) {
      throw new Error(`Invalid iso/config.json: ${err.message}`);
    }
  }

  const agents = await loadMarkdownDir(path.join(abs, 'agents'));
  const commands = await loadMarkdownDir(path.join(abs, 'commands'));

  return {
    sourceDir: abs,
    config,
    instructions: instructions ?? '',
    mcp,
    agents,
    commands,
  };
}

export function targetOverride(item, target) {
  const t = item.targets?.[target];
  if (t === 'skip' || t === false) return { skip: true };
  if (!t || typeof t !== 'object') return { skip: false, override: {} };
  return { skip: false, override: t };
}

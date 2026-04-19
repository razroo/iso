import path from 'node:path';
import { promises as fs } from 'node:fs';
import { writeFile } from '../fs-utils.mjs';

function tomlString(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlArray(arr) {
  return `[${arr.map(tomlString).join(', ')}]`;
}

function tomlInlineTable(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `${k} = ${tomlString(v)}`);
  return `{ ${parts.join(', ')} }`;
}

function renderMcpToml(servers) {
  const lines = [];
  for (const [name, def] of Object.entries(servers)) {
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`command = ${tomlString(def.command)}`);
    if (def.args?.length) lines.push(`args = ${tomlArray(def.args)}`);
    if (def.env && Object.keys(def.env).length) {
      lines.push(`env = ${tomlInlineTable(def.env)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// Strip every `[mcp_servers.*]` section (from the header through the next
// section heading or EOF) from a TOML text. Preserves all other content
// verbatim — top-level keys, comments, and unrelated sections — so
// co-authored config.toml files (e.g. iso-route's model + profile blocks)
// survive the iso-harness MCP rewrite.
function stripMcpServerSections(text) {
  const lines = text.split('\n');
  const out = [];
  let inMcpSection = false;
  for (const line of lines) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      inMcpSection = m[1].startsWith('mcp_servers.');
    }
    if (!inMcpSection) out.push(line);
  }
  return out.join('\n');
}

async function readIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function emitCodex(src, outDir, opts = {}) {
  const written = [];
  const push = async (p, content) => {
    const { bytes } = await writeFile(p, content, opts);
    written.push({ path: p, bytes });
  };

  if (src.instructions) {
    const p = path.join(outDir, 'AGENTS.md');
    await push(p, src.instructions.endsWith('\n') ? src.instructions : src.instructions + '\n');
  }

  if (Object.keys(src.mcp.servers).length > 0) {
    const p = path.join(outDir, '.codex', 'config.toml');
    // Merge — not overwrite. `@razroo/iso-route` writes model + profiles +
    // model_providers to this same file; iso-harness owns only the
    // `[mcp_servers.*]` sections. Strip those from any existing file,
    // preserve everything else, and append the freshly-rendered MCP block.
    const existing = opts.dryRun ? null : await readIfExists(p);
    const mcpBlock = renderMcpToml(src.mcp.servers);
    let body;
    if (existing) {
      const preserved = stripMcpServerSections(existing).trimEnd();
      body = preserved ? `${preserved}\n\n${mcpBlock}` : mcpBlock;
    } else {
      body = mcpBlock;
    }
    await push(p, body);
  }

  return written;
}

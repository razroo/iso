import path from 'node:path';
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
    const body = renderMcpToml(src.mcp.servers);
    const p = path.join(outDir, '.codex', 'config.toml');
    await push(p, body);
  }

  return written;
}

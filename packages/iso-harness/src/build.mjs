import { loadSource } from './source.mjs';
import { validateSource, ValidationError, formatDiagnostic } from './validate.mjs';
import { emitClaude } from './targets/claude.mjs';
import { emitCursor } from './targets/cursor.mjs';
import { emitCodex } from './targets/codex.mjs';
import { emitOpenCode } from './targets/opencode.mjs';
import path from 'node:path';

const EMITTERS = {
  claude: emitClaude,
  cursor: emitCursor,
  codex: emitCodex,
  opencode: emitOpenCode,
};

export async function build({ source, out, targets }) {
  const src = await loadSource(source);
  const diagnostics = validateSource(src);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new ValidationError(diagnostics);

  const outAbs = path.resolve(out);
  const summary = [`iso-harness: loaded ${src.agents.length} agent(s), ${src.commands.length} command(s), ${Object.keys(src.mcp.servers).length} MCP server(s) from ${src.sourceDir}`];
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  for (const w of warnings) summary.push(`  warning: ${formatDiagnostic(w)}`);

  for (const target of targets) {
    const emit = EMITTERS[target];
    const written = await emit(src, outAbs);
    summary.push(`  [${target}] wrote ${written.length} file(s)`);
    for (const f of written) summary.push(`    - ${path.relative(outAbs, f)}`);
  }
  return summary;
}

export async function validate({ source }) {
  const src = await loadSource(source);
  return validateSource(src);
}

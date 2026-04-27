import { loadSource } from './source.mjs';
import { validateSource, ValidationError, formatDiagnostic } from './validate.mjs';
import { emitClaude } from './targets/claude.mjs';
import { emitCursor } from './targets/cursor.mjs';
import { emitCodex } from './targets/codex.mjs';
import { emitOpenCode } from './targets/opencode.mjs';
import { emitPi } from './targets/pi.mjs';
import path from 'node:path';

const EMITTERS = {
  claude: emitClaude,
  cursor: emitCursor,
  codex: emitCodex,
  opencode: emitOpenCode,
  pi: emitPi,
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export async function build({ source, out, targets, dryRun = false }) {
  const src = await loadSource(source);
  const diagnostics = validateSource(src);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new ValidationError(diagnostics);

  const outAbs = path.resolve(out);
  const prefix = dryRun ? 'iso-harness (dry-run)' : 'iso-harness';
  const summary = [`${prefix}: loaded ${src.agents.length} agent(s), ${src.commands.length} command(s), ${Object.keys(src.mcp.servers).length} MCP server(s) from ${src.sourceDir}`];
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  for (const w of warnings) summary.push(`  warning: ${formatDiagnostic(w)}`);

  const opts = { dryRun };
  let totalBytes = 0;
  let totalFiles = 0;
  for (const target of targets) {
    const emit = EMITTERS[target];
    const written = await emit(src, outAbs, opts);
    const verb = dryRun ? 'would write' : 'wrote';
    summary.push(`  [${target}] ${verb} ${written.length} file(s)`);
    for (const f of written) {
      totalBytes += f.bytes;
      totalFiles += 1;
      const size = dryRun ? ` (${formatBytes(f.bytes)})` : '';
      summary.push(`    - ${path.relative(outAbs, f.path)}${size}`);
    }
  }
  if (dryRun) {
    summary.push(`\n${totalFiles} file(s), ${formatBytes(totalBytes)} — no files written`);
  }
  return summary;
}

export async function validate({ source }) {
  const src = await loadSource(source);
  return validateSource(src);
}

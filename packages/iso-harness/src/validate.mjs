// Schema validation for a loaded iso/ source directory. Runs before any
// target emitter so a typo in frontmatter, a malformed mcp.json, or an
// unknown target key fails fast instead of silently fanning out wrong
// configs to four harnesses.
//
// Deliberately hand-rolled — the package has one runtime dep (yaml) and
// we don't want to pull ajv in just for this.

const KNOWN_TARGETS = ['claude', 'cursor', 'codex', 'opencode'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateTargetsField(targets, file, where) {
  const diags = [];
  if (targets === undefined) return diags;
  if (!isPlainObject(targets)) {
    diags.push({
      severity: 'error',
      file,
      field: `${where}.targets`,
      message: `"targets" must be an object keyed by harness name`,
    });
    return diags;
  }
  for (const [k, v] of Object.entries(targets)) {
    if (!KNOWN_TARGETS.includes(k)) {
      diags.push({
        severity: 'warning',
        file,
        field: `${where}.targets.${k}`,
        message: `Unknown target "${k}" — known targets: ${KNOWN_TARGETS.join(', ')}. Override will be ignored.`,
      });
      continue;
    }
    if (v === 'skip' || v === false) continue;
    if (v === true || v === 'include' || v === null || v === undefined) continue;
    if (!isPlainObject(v)) {
      diags.push({
        severity: 'error',
        file,
        field: `${where}.targets.${k}`,
        message: `Target override for "${k}" must be "skip", false, or an override object — got ${typeof v}`,
      });
    }
  }
  return diags;
}

export function validateMcp(mcp, file = 'iso/mcp.json') {
  const diags = [];
  if (!mcp || !isPlainObject(mcp)) {
    return [
      {
        severity: 'error',
        file,
        message: `mcp.json must be a JSON object`,
      },
    ];
  }
  if (!isPlainObject(mcp.servers)) {
    return [
      {
        severity: 'error',
        file,
        field: 'servers',
        message: `mcp.json must have a "servers" object`,
      },
    ];
  }
  for (const [name, def] of Object.entries(mcp.servers)) {
    const where = `servers.${name}`;
    if (!isPlainObject(def)) {
      diags.push({
        severity: 'error',
        file,
        field: where,
        message: `Server "${name}" must be an object`,
      });
      continue;
    }
    if (typeof def.command !== 'string' || !def.command.trim()) {
      diags.push({
        severity: 'error',
        file,
        field: `${where}.command`,
        message: `Server "${name}" is missing a non-empty "command" string`,
      });
    }
    if (def.args !== undefined && !isStringArray(def.args)) {
      diags.push({
        severity: 'error',
        file,
        field: `${where}.args`,
        message: `Server "${name}" has non-string-array "args"`,
      });
    }
    if (def.env !== undefined) {
      if (!isPlainObject(def.env)) {
        diags.push({
          severity: 'error',
          file,
          field: `${where}.env`,
          message: `Server "${name}" "env" must be an object of string→string`,
        });
      } else {
        for (const [k, v] of Object.entries(def.env)) {
          if (typeof v !== 'string') {
            diags.push({
              severity: 'error',
              file,
              field: `${where}.env.${k}`,
              message: `Server "${name}" env var "${k}" must be a string (env is passed literally to the MCP process)`,
            });
          }
        }
      }
    }
  }
  return diags;
}

export function validateConfig(config, file = 'iso/config.json') {
  const diags = [];
  if (config === undefined || config === null) return diags;
  if (!isPlainObject(config)) {
    return [
      {
        severity: 'error',
        file,
        message: `config.json must be a JSON object`,
      },
    ];
  }
  if (config.targets !== undefined && !isPlainObject(config.targets)) {
    diags.push({
      severity: 'error',
      file,
      field: 'targets',
      message: `"targets" must be an object keyed by harness name`,
    });
  }
  if (isPlainObject(config.targets)) {
    for (const k of Object.keys(config.targets)) {
      if (!KNOWN_TARGETS.includes(k)) {
        diags.push({
          severity: 'warning',
          file,
          field: `targets.${k}`,
          message: `Unknown target "${k}" — known targets: ${KNOWN_TARGETS.join(', ')}. Override will be ignored.`,
        });
      }
    }
  }
  return diags;
}

function validateAgentOrCommand(item, kind) {
  const file = `iso/${kind === 'agent' ? 'agents' : 'commands'}/${item.slug}.md`;
  const diags = [];

  if (typeof item.name !== 'string' || !item.name.trim()) {
    diags.push({
      severity: 'error',
      file,
      field: 'name',
      message: `${kind} "${item.slug}" is missing a non-empty "name" (either in frontmatter or via filename)`,
    });
  }
  if (typeof item.description !== 'string' || !item.description.trim()) {
    diags.push({
      severity: 'warning',
      file,
      field: 'description',
      message: `${kind} "${item.slug}" has no "description" — downstream harnesses will emit an empty description field`,
    });
  }
  if (item.model !== undefined && typeof item.model !== 'string') {
    diags.push({
      severity: 'error',
      file,
      field: 'model',
      message: `"model" must be a string (got ${typeof item.model})`,
    });
  }
  if (item.tools !== undefined) {
    const ok = isStringArray(item.tools) || isPlainObject(item.tools) || typeof item.tools === 'string';
    if (!ok) {
      diags.push({
        severity: 'error',
        file,
        field: 'tools',
        message: `"tools" must be a string, string[], or object (got ${Array.isArray(item.tools) ? 'array of non-strings' : typeof item.tools})`,
      });
    }
  }
  diags.push(...validateTargetsField(item.targets, file, ''));

  if (typeof item.body !== 'string' || !item.body.trim()) {
    diags.push({
      severity: 'warning',
      file,
      message: `${kind} "${item.slug}" has an empty body — the prompt the harness sees will be blank`,
    });
  }
  return diags;
}

function validateUniqueNames(items, kind) {
  const seen = new Map();
  const diags = [];
  for (const item of items) {
    const prior = seen.get(item.name);
    if (prior !== undefined) {
      diags.push({
        severity: 'error',
        file: `iso/${kind === 'agent' ? 'agents' : 'commands'}/${item.slug}.md`,
        field: 'name',
        message: `Duplicate ${kind} name "${item.name}" — first seen in ${prior}. Names must be unique within a kind.`,
      });
    } else {
      seen.set(
        item.name,
        `iso/${kind === 'agent' ? 'agents' : 'commands'}/${item.slug}.md`,
      );
    }
  }
  return diags;
}

export function validateSource(src) {
  const diags = [];
  diags.push(...validateMcp(src.mcp));
  diags.push(...validateConfig(src.config));
  for (const agent of src.agents) diags.push(...validateAgentOrCommand(agent, 'agent'));
  for (const cmd of src.commands) diags.push(...validateAgentOrCommand(cmd, 'command'));
  diags.push(...validateUniqueNames(src.agents, 'agent'));
  diags.push(...validateUniqueNames(src.commands, 'command'));
  return diags;
}

export function formatDiagnostic(d) {
  const loc = d.file + (d.field ? ` (${d.field})` : '');
  return `${d.severity} ${loc}: ${d.message}`;
}

export class ValidationError extends Error {
  constructor(diagnostics) {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    super(
      `iso-harness: source validation failed (${errors.length} error${errors.length === 1 ? '' : 's'})\n` +
        diagnostics.map(formatDiagnostic).map((s) => `  ${s}`).join('\n'),
    );
    this.name = 'ValidationError';
    this.diagnostics = diagnostics;
  }
}

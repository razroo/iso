import { isJsonObject } from "./json.js";
import type {
  CapabilityCheckResult,
  CapabilityInput,
  CapabilityIssue,
  CapabilityPolicy,
  CapabilityRequest,
  CapabilityRole,
  FilesystemAccess,
  FilesystemMode,
  NetworkMode,
  ResolvedCapabilityRole,
} from "./types.js";

const FILESYSTEM_MODES: readonly FilesystemMode[] = [
  "none",
  "read-only",
  "project-write",
  "workspace-write",
  "unrestricted",
];

const NETWORK_MODES: readonly NetworkMode[] = ["off", "restricted", "on"];

export function loadCapabilityPolicy(input: CapabilityInput): CapabilityPolicy {
  const roles = Array.isArray(input)
    ? input
    : isCapabilityPolicy(input)
      ? input.roles
      : [input as CapabilityRole];

  if (!roles.length) throw new Error("capability policy must define at least one role");

  const normalized = roles.map((role) => normalizeRole(role));
  const seen = new Set<string>();
  for (const role of normalized) {
    if (seen.has(role.name)) throw new Error(`duplicate capability role "${role.name}"`);
    seen.add(role.name);
  }

  for (const role of normalized) {
    for (const parent of parentNames(role)) {
      if (!seen.has(parent)) throw new Error(`capability role "${role.name}" extends unknown role "${parent}"`);
    }
  }

  const policy = { roles: normalized };
  for (const role of normalized) resolveRole(policy, role.name);
  return policy;
}

export function roleNames(policy: CapabilityPolicy): string[] {
  return policy.roles.map((role) => role.name).sort();
}

export function getRole(policy: CapabilityPolicy, name: string): CapabilityRole {
  const role = policy.roles.find((candidate) => candidate.name === name);
  if (!role) {
    const available = roleNames(policy).join(", ") || "(none)";
    throw new Error(`unknown capability role "${name}" (available: ${available})`);
  }
  return role;
}

export function resolveRole(policy: CapabilityPolicy, name: string): ResolvedCapabilityRole {
  const byName = new Map(policy.roles.map((role) => [role.name, role] as const));
  return resolveWithStack(byName, name, []);
}

export function checkCapability(
  role: ResolvedCapabilityRole,
  request: CapabilityRequest,
): CapabilityCheckResult {
  const issues: CapabilityIssue[] = [];

  for (const tool of request.tools || []) {
    if (!allowsName(role.tools, tool)) {
      issues.push({
        kind: "tool-not-allowed",
        subject: tool,
        message: `tool "${tool}" is not allowed for role "${role.name}"`,
      });
    }
  }

  for (const server of request.mcp || []) {
    if (!allowsName(role.mcp, server)) {
      issues.push({
        kind: "mcp-not-allowed",
        subject: server,
        message: `MCP server "${server}" is not allowed for role "${role.name}"`,
      });
    }
  }

  for (const command of request.commands || []) {
    const denied = firstPatternMatch(role.commands.deny, command);
    if (denied) {
      issues.push({
        kind: "command-denied",
        subject: command,
        matched: denied,
        message: `command "${command}" is denied by pattern "${denied}"`,
      });
      continue;
    }
    const allowed = firstPatternMatch(role.commands.allow, command);
    if (!allowed) {
      issues.push({
        kind: "command-not-allowed",
        subject: command,
        message: `command "${command}" is not allowed for role "${role.name}"`,
      });
    }
  }

  for (const access of request.filesystem || []) {
    if (!allowsFilesystem(role.filesystem, access)) {
      issues.push({
        kind: "filesystem-not-allowed",
        subject: access,
        message: `filesystem ${access} is not allowed by mode "${role.filesystem}"`,
      });
    }
  }

  if (request.network && !allowsNetwork(role.network, request.network)) {
    issues.push({
      kind: "network-not-allowed",
      subject: request.network,
      message: `network "${request.network}" is not allowed by mode "${role.network}"`,
    });
  }

  return { ok: issues.length === 0, role, request, issues };
}

export function checkRoleCapability(
  policy: CapabilityPolicy,
  roleName: string,
  request: CapabilityRequest,
): CapabilityCheckResult {
  return checkCapability(resolveRole(policy, roleName), request);
}

export function matchesPattern(pattern: string, value: string): boolean {
  const cleanPattern = pattern.trim();
  const cleanValue = value.trim();
  if (cleanPattern === "*") return true;
  if (cleanPattern.endsWith("*")) {
    return cleanValue.startsWith(cleanPattern.slice(0, -1));
  }
  return cleanPattern === cleanValue;
}

function resolveWithStack(
  roles: Map<string, CapabilityRole>,
  name: string,
  stack: string[],
): ResolvedCapabilityRole {
  const role = roles.get(name);
  if (!role) {
    const available = [...roles.keys()].sort().join(", ") || "(none)";
    throw new Error(`unknown capability role "${name}" (available: ${available})`);
  }
  if (stack.includes(name)) {
    throw new Error(`capability role cycle: ${[...stack, name].join(" -> ")}`);
  }

  const parents = parentNames(role);
  let resolved = emptyResolvedRole(role.name, parents);
  for (const parent of parents) {
    resolved = mergeParent(resolved, resolveWithStack(roles, parent, [...stack, name]));
  }
  return applyRole(resolved, role);
}

function emptyResolvedRole(name: string, parents: string[]): ResolvedCapabilityRole {
  return {
    name,
    extends: parents,
    tools: [],
    mcp: [],
    commands: { allow: [], deny: [] },
    filesystem: "read-only",
    network: "off",
    notes: [],
  };
}

function mergeParent(base: ResolvedCapabilityRole, parent: ResolvedCapabilityRole): ResolvedCapabilityRole {
  return {
    ...base,
    description: base.description ?? parent.description,
    tools: unique([...parent.tools, ...base.tools]),
    mcp: unique([...parent.mcp, ...base.mcp]),
    commands: {
      allow: unique([...parent.commands.allow, ...base.commands.allow]),
      deny: unique([...parent.commands.deny, ...base.commands.deny]),
    },
    filesystem: parent.filesystem,
    network: parent.network,
    notes: unique([...parent.notes, ...base.notes]),
  };
}

function applyRole(base: ResolvedCapabilityRole, role: CapabilityRole): ResolvedCapabilityRole {
  return {
    ...base,
    description: role.description ?? base.description,
    tools: unique([...base.tools, ...(role.tools || [])]),
    mcp: unique([...base.mcp, ...(role.mcp || [])]),
    commands: {
      allow: unique([...base.commands.allow, ...(role.commands?.allow || [])]),
      deny: unique([...base.commands.deny, ...(role.commands?.deny || [])]),
    },
    filesystem: role.filesystem ?? base.filesystem,
    network: role.network ?? base.network,
    notes: unique([...base.notes, ...(role.notes || [])]),
  };
}

function normalizeRole(value: unknown): CapabilityRole {
  if (!isJsonObject(value)) throw new Error("capability role must be a JSON object");
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("capability role name must be a non-empty string");
  }

  const role: CapabilityRole = { name: value.name.trim() };
  if (value.description !== undefined) role.description = requireString(value.description, `${role.name}.description`);
  if (value.extends !== undefined) role.extends = normalizeExtends(value.extends, `${role.name}.extends`);
  if (value.tools !== undefined) role.tools = normalizeStringArray(value.tools, `${role.name}.tools`);
  if (value.mcp !== undefined) role.mcp = normalizeStringArray(value.mcp, `${role.name}.mcp`);
  if (value.commands !== undefined) role.commands = normalizeCommands(value.commands, `${role.name}.commands`);
  if (value.filesystem !== undefined) role.filesystem = normalizeFilesystem(value.filesystem, `${role.name}.filesystem`);
  if (value.network !== undefined) role.network = normalizeNetwork(value.network, `${role.name}.network`);
  if (value.notes !== undefined) role.notes = normalizeStringArray(value.notes, `${role.name}.notes`);
  return role;
}

function isCapabilityPolicy(input: CapabilityInput): input is CapabilityPolicy {
  return isJsonObject(input) && Array.isArray((input as { roles?: unknown }).roles);
}

function parentNames(role: CapabilityRole): string[] {
  if (!role.extends) return [];
  const parents = Array.isArray(role.extends) ? role.extends : [role.extends];
  return unique(parents.map((parent) => parent.trim()).filter(Boolean));
}

function normalizeExtends(value: unknown, path: string): string | string[] {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`${path} must not be empty`);
    return value.trim();
  }
  return normalizeStringArray(value, path);
}

function normalizeCommands(value: unknown, path: string): { allow?: string[]; deny?: string[] } {
  if (!isJsonObject(value)) throw new Error(`${path} must be a JSON object`);
  const commands: { allow?: string[]; deny?: string[] } = {};
  if (value.allow !== undefined) commands.allow = normalizeStringArray(value.allow, `${path}.allow`);
  if (value.deny !== undefined) commands.deny = normalizeStringArray(value.deny, `${path}.deny`);
  return commands;
}

function normalizeStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of strings`);
  const result = value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${path}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
  return unique(result);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value.trim();
}

function normalizeFilesystem(value: unknown, path: string): FilesystemMode {
  if (typeof value === "string" && (FILESYSTEM_MODES as readonly string[]).includes(value)) {
    return value as FilesystemMode;
  }
  throw new Error(`${path} must be one of: ${FILESYSTEM_MODES.join(", ")}`);
}

function normalizeNetwork(value: unknown, path: string): NetworkMode {
  if (typeof value === "string" && (NETWORK_MODES as readonly string[]).includes(value)) {
    return value as NetworkMode;
  }
  throw new Error(`${path} must be one of: ${NETWORK_MODES.join(", ")}`);
}

function allowsName(allowed: string[], value: string): boolean {
  return allowed.includes("*") || allowed.includes(value);
}

function firstPatternMatch(patterns: string[], value: string): string | undefined {
  return patterns.find((pattern) => matchesPattern(pattern, value));
}

function allowsFilesystem(mode: FilesystemMode, access: FilesystemAccess): boolean {
  if (access === "read") return mode !== "none";
  return mode === "project-write" || mode === "workspace-write" || mode === "unrestricted";
}

function allowsNetwork(actual: NetworkMode, requested: NetworkMode): boolean {
  const order: Record<NetworkMode, number> = { off: 0, restricted: 1, on: 2 };
  return order[requested] <= order[actual];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

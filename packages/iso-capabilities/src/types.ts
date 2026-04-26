export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type FilesystemMode =
  | "none"
  | "read-only"
  | "project-write"
  | "workspace-write"
  | "unrestricted";

export type FilesystemAccess = "read" | "write";
export type NetworkMode = "off" | "restricted" | "on";
export type RenderTarget = "markdown" | "claude" | "codex" | "cursor" | "opencode" | "json";

export interface CommandPolicy {
  allow?: string[];
  deny?: string[];
}

export interface CapabilityRole {
  name: string;
  description?: string;
  extends?: string | string[];
  tools?: string[];
  mcp?: string[];
  commands?: CommandPolicy;
  filesystem?: FilesystemMode;
  network?: NetworkMode;
  notes?: string[];
}

export interface CapabilityPolicy {
  roles: CapabilityRole[];
}

export type CapabilityInput = CapabilityPolicy | CapabilityRole | CapabilityRole[];

export interface ResolvedCommandPolicy {
  allow: string[];
  deny: string[];
}

export interface ResolvedCapabilityRole {
  name: string;
  description?: string;
  extends: string[];
  tools: string[];
  mcp: string[];
  commands: ResolvedCommandPolicy;
  filesystem: FilesystemMode;
  network: NetworkMode;
  notes: string[];
}

export interface CapabilityRequest {
  tools?: string[];
  mcp?: string[];
  commands?: string[];
  filesystem?: FilesystemAccess[];
  network?: NetworkMode;
}

export type CapabilityIssueKind =
  | "tool-not-allowed"
  | "mcp-not-allowed"
  | "command-denied"
  | "command-not-allowed"
  | "filesystem-not-allowed"
  | "network-not-allowed";

export interface CapabilityIssue {
  kind: CapabilityIssueKind;
  subject: string;
  message: string;
  matched?: string;
}

export interface CapabilityCheckResult {
  ok: boolean;
  role: ResolvedCapabilityRole;
  request: CapabilityRequest;
  issues: CapabilityIssue[];
}

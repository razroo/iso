import assert from "node:assert/strict";
import test from "node:test";

import {
  checkCapability,
  checkRoleCapability,
  loadCapabilityPolicy,
  matchesPattern,
  resolveRole,
} from "../src/index.js";

const input = {
  roles: [
    {
      name: "base",
      description: "Base role",
      tools: ["read", "search"],
      mcp: ["state-trace"],
      commands: {
        allow: ["npm test", "npx job-forge *"],
        deny: ["rm -rf *"],
      },
      filesystem: "read-only",
      network: "off",
      notes: ["base note"],
    },
    {
      name: "applicant",
      extends: "base",
      tools: ["browser", "read"],
      mcp: ["geometra"],
      commands: {
        allow: ["npx job-forge merge"],
      },
      filesystem: "project-write",
      network: "restricted",
      notes: ["child note"],
    },
  ],
} as const;

test("loads and resolves inherited capabilities", () => {
  const policy = loadCapabilityPolicy(input);
  const role = resolveRole(policy, "applicant");

  assert.deepEqual(role.extends, ["base"]);
  assert.deepEqual(role.tools, ["read", "search", "browser"]);
  assert.deepEqual(role.mcp, ["state-trace", "geometra"]);
  assert.deepEqual(role.commands.allow, ["npm test", "npx job-forge *", "npx job-forge merge"]);
  assert.deepEqual(role.commands.deny, ["rm -rf *"]);
  assert.equal(role.filesystem, "project-write");
  assert.equal(role.network, "restricted");
  assert.deepEqual(role.notes, ["base note", "child note"]);
});

test("checks tools, MCP, commands, filesystem, and network", () => {
  const policy = loadCapabilityPolicy(input);
  const pass = checkRoleCapability(policy, "applicant", {
    tools: ["browser"],
    mcp: ["geometra"],
    commands: ["npx job-forge merge"],
    filesystem: ["write"],
    network: "restricted",
  });

  assert.equal(pass.ok, true);

  const role = resolveRole(policy, "applicant");
  const fail = checkCapability(role, {
    tools: ["unknown-tool"],
    mcp: ["gmail"],
    commands: ["rm -rf data"],
    filesystem: ["write"],
    network: "on",
  });

  assert.equal(fail.ok, false);
  assert.deepEqual(fail.issues.map((issue) => issue.kind), [
    "tool-not-allowed",
    "mcp-not-allowed",
    "command-denied",
    "network-not-allowed",
  ]);
});

test("reports not-allowlisted commands after deny checks", () => {
  const policy = loadCapabilityPolicy(input);
  const result = checkRoleCapability(policy, "applicant", {
    commands: ["npm publish"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.kind, "command-not-allowed");
});

test("detects duplicate roles, unknown parents, and inheritance cycles", () => {
  assert.throws(
    () => loadCapabilityPolicy([{ name: "a" }, { name: "a" }]),
    /duplicate capability role "a"/,
  );
  assert.throws(
    () => loadCapabilityPolicy([{ name: "a", extends: "missing" }]),
    /extends unknown role "missing"/,
  );
  assert.throws(
    () => loadCapabilityPolicy([{ name: "a", extends: "b" }, { name: "b", extends: "a" }]),
    /capability role cycle: a -> b -> a/,
  );
});

test("matches exact and trailing-star command patterns", () => {
  assert.equal(matchesPattern("npm test", "npm test"), true);
  assert.equal(matchesPattern("npm run *", "npm run verify"), true);
  assert.equal(matchesPattern("npm run *", "npm publish"), false);
  assert.equal(matchesPattern("*", "anything"), true);
});

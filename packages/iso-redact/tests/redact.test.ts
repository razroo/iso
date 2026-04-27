import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatScanResult,
  listRedactRules,
  loadRedactConfig,
  redactText,
  scanText,
} from "../src/index.js";
import type { RedactConfig } from "../src/index.js";

const config: RedactConfig = loadRedactConfig({
  version: 1,
  defaults: {
    severity: "error",
    replacement: "[REDACTED:{id}]",
  },
  builtins: [
    "email",
    "openai-api-key",
    "proxy-url-credentials",
    { id: "phone", severity: "warn" },
  ],
  fields: [
    {
      id: "proxy-config",
      names: ["server", "username", "password", "bypass"],
    },
    {
      id: "credential-field",
      names: ["token", "api_key"],
    },
  ],
  patterns: [
    {
      id: "ticket",
      label: "Internal ticket",
      pattern: "\\bSEC-[0-9]{4,}\\b",
      severity: "warn",
    },
  ],
});

describe("iso-redact", () => {
  it("loads and explains builtin, field, and pattern rules", () => {
    const rules = listRedactRules(config);
    assert.deepEqual(rules.map((rule) => rule.id), [
      "email",
      "openai-api-key",
      "proxy-url-credentials",
      "phone",
      "ticket",
      "proxy-config",
      "credential-field",
    ]);
    assert.equal(rules.find((rule) => rule.id === "phone")?.severity, "warn");
  });

  it("finds sensitive values without returning the original secret in findings", () => {
    const text = [
      "email: charlie@example.com",
      "token=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
      "proxy: http://user:pass@example.test:8080",
      "password: \"hunter2\"",
      "reference SEC-12345",
    ].join("\n");

    const result = scanText(config, text, { source: "sample.txt" });

    assert.equal(result.ok, false);
    assert.equal(result.totals.findings, 5);
    assert.equal(result.totals.byRule.email, 1);
    assert.equal(result.totals.byRule["openai-api-key"], 1);
    assert.equal(result.totals.byRule["proxy-url-credentials"], 1);
    assert.equal(result.totals.byRule["proxy-config"], 1);
    assert.equal(result.totals.byRule.ticket, 1);
    assert.doesNotMatch(JSON.stringify(result.findings), /hunter2|charlie@example|abcdefghijklmnopqrstuvwxyz/);
    assert.match(formatScanResult(result), /iso-redact: FOUND/);
  });

  it("redacts while preserving field keys and quotes", () => {
    const text = [
      "email: charlie@example.com",
      "password: \"hunter2\"",
      "api_key=internal-secret-value",
    ].join("\n");

    const result = redactText(config, text, { source: "profile.yml" });

    assert.equal(result.changed, true);
    assert.match(result.text, /email: \[REDACTED:email\]/);
    assert.match(result.text, /password: "\[REDACTED:proxy-config\]"/);
    assert.match(result.text, /api_key=\[REDACTED:credential-field\]/);
    assert.doesNotMatch(result.text, /hunter2|charlie@example|internal-secret-value/);
  });

  it("does not flag its own replacement markers on a second pass", () => {
    const once = redactText(config, "password: \"hunter2\"\n", { source: "profile.yml" });
    const twice = scanText(config, once.text, { source: "profile.yml" });

    assert.equal(once.text, "password: \"[REDACTED:proxy-config]\"\n");
    assert.equal(twice.ok, true);
  });

  it("reports clean text as ok", () => {
    const result = scanText(config, "No sensitive values here.", { source: "clean.txt" });

    assert.equal(result.ok, true);
    assert.equal(result.totals.findings, 0);
    assert.match(formatScanResult(result, "verify"), /iso-redact: PASS/);
  });

  it("rejects unknown builtins", () => {
    assert.throws(() => loadRedactConfig({ version: 1, builtins: ["missing"] }), /unknown builtin/);
  });
});

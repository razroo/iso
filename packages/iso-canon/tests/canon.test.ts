import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeCompany,
  canonicalizeCompanyRole,
  canonicalizeRole,
  canonicalizeUrl,
  compareCanon,
  loadCanonConfig,
  resolveProfile,
} from "../src/index.js";

function jobforgeProfile() {
  return resolveProfile(loadCanonConfig({
    version: 1,
    profiles: [
      {
        name: "jobforge",
        company: {
          aliases: {
            "open ai": "openai",
            "anthropic pbc": "anthropic",
          },
        },
        role: {
          aliases: {
            swe: "software engineer",
          },
          stopWords: ["remote", "us"],
        },
      },
    ],
  }), "jobforge");
}

test("canonicalizes URLs with tracking query and fragment cleanup", () => {
  const result = canonicalizeUrl("https://www.example.com/jobs/123/?utm_source=x&gh_src=y&foo=bar#apply");
  assert.equal(result.canonical, "https://example.com/jobs/123?foo=bar");
  assert.equal(result.key, "url:https://example.com/jobs/123?foo=bar");
});

test("canonicalizes company aliases and legal suffixes", () => {
  const profile = jobforgeProfile();
  assert.equal(canonicalizeCompany("OpenAI, Inc.", profile).key, "company:openai");
  assert.equal(canonicalizeCompany("Open AI", profile).key, "company:openai");
  assert.equal(canonicalizeCompany("Anthropic, PBC", profile).key, "company:anthropic");
});

test("canonicalizes role aliases and stop words", () => {
  const result = canonicalizeRole("Senior SWE, AI Platform - Remote US", jobforgeProfile());
  assert.deepEqual(result.tokens, ["senior", "software", "engineer", "ai", "platform"]);
  assert.equal(result.key, "role:senior-software-engineer-ai-platform");
});

test("builds stable company-role keys", () => {
  const result = canonicalizeCompanyRole("Anthropic, PBC", "Senior SWE, AI Platform - Remote US", jobforgeProfile());
  assert.equal(result.key, "company-role:anthropic:senior-software-engineer-ai-platform");
});

test("compares exact and possible duplicates with explanations", () => {
  const profile = jobforgeProfile();
  const same = compareCanon("company", "OpenAI, Inc.", "Open AI", profile);
  assert.equal(same.verdict, "same");
  assert.equal(same.score, 1);
  assert.deepEqual(same.reasons, ["keys match"]);

  const possible = compareCanon("role", "Senior Software Engineer, AI Platform", "Senior SWE Platform", profile);
  assert.equal(possible.verdict, "possible");
  assert.ok(possible.score >= 0.78);
});

test("rejects invalid profile config", () => {
  assert.throws(
    () => loadCanonConfig({
      version: 1,
      profiles: [{ name: "bad", match: { possible: 0.95, strong: 0.9 } }],
    }),
    /possible must be less than or equal to strong/,
  );
});

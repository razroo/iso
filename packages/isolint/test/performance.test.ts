import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG } from "../src/lint/config.js";
import { runLint } from "../src/lint/runner.js";
import { PERFORMANCE_RULES } from "../src/lint/rules/performance.js";
import { computeFixes } from "../src/lint/fix.js";
import { MockProvider } from "../src/providers/mock.js";

const cfg = { ...DEFAULT_CONFIG };

async function perfLint(source: string, file = "modes/test.md") {
  return runLint([{ rel_path: file, source }], cfg, { rules: PERFORMANCE_RULES });
}

describe("performance preset", () => {
  it("runs through config.extends = [performance]", async () => {
    const source = [
      "## Intake",
      "",
      "Validate the input schema before saving the result.",
      "",
      "## Output",
      "",
      "Validate the input schema before saving the result.",
    ].join("\n");

    const report = await runLint(
      [{ rel_path: "modes/test.md", source }],
      { ...DEFAULT_CONFIG, extends: ["performance"] },
    );

    assert.ok(report.findings.some((f) => f.rule_id === "perf-repeated-instruction-block"));
  });
});

describe("performance rules", () => {
  it("flags repeated instruction blocks across sections", async () => {
    const source = [
      "## Intake",
      "",
      "Validate the input schema before saving the result.",
      "",
      "## Output",
      "",
      "Validate the input schema before saving the result.",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-repeated-instruction-block"));
  });

  it("flags examples that outweigh the task definition", async () => {
    const example = Array.from(
      { length: 18 },
      () => "Example rows show every field, every edge case, and every alternative phrasing in full detail.",
    ).join(" ");
    const source = [
      "## Task",
      "",
      "Classify the ticket and return JSON.",
      "",
      "## Example",
      "",
      example,
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-example-heavy-section"));
  });

  it("flags duplicated output requirements", async () => {
    const source = [
      "## Step 1",
      "",
      "Return JSON with fields `name` and `score`.",
      "",
      "## Step 2",
      "",
      "Return JSON with fields `name` and `score`.",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-duplicated-output-requirement"));
  });

  it("flags later steps that restate prior steps", async () => {
    const source = [
      "## Step 1",
      "",
      "Classify the ticket into one label, using the input message and the policy guide to choose the single best category.",
      "",
      "## Step 2",
      "",
      "Classify the ticket into one label, using the input message and the policy guide to choose the single best category.",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-step-restates-prior-step"));
  });

  it("flags large prose sections with weak operational value", async () => {
    const filler = Array.from(
      { length: 8 },
      () => "This background section offers broad context, narrative framing, historical notes, and extra commentary about the surrounding environment.",
    ).join(" ");
    const source = [
      "## Guidance",
      "",
      filler,
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-low-value-prose-section"));
  });

  it("flags large shared-prefix files that should be split into stable core plus references", async () => {
    const source = Array.from(
      { length: 220 },
      (_, i) => `Instruction block ${i + 1} explains another stable policy that would be cheaper in an on-demand reference file.`,
    ).join("\n\n");
    const report = await perfLint(source, "modes/_shared.md");
    assert.ok(report.findings.some((f) => f.rule_id === "perf-shared-prefix-budget"));
  });

  it("flags large structured example blocks embedded in shared-prefix files", async () => {
    const payload = Array.from(
      { length: 40 },
      (_, i) => `  "field_${i}": "example value ${i}"`,
    ).join(",\n");
    const source = [
      "# Shared Context",
      "",
      "Example JSON shape:",
      "",
      "```json",
      "{",
      payload,
      "}",
      "```",
    ].join("\n");
    const report = await perfLint(source, ".cursor/rules/main.mdc");
    assert.ok(report.findings.some((f) => f.rule_id === "perf-large-example-in-shared-prefix"));
  });

  it("flags long numbered runbooks embedded in shared-prefix files", async () => {
    const source = [
      "# Global Rules",
      "",
      "1. Read the current tracker, inspect the pipeline state, verify prerequisites, and confirm that all required setup files exist before doing anything else in the workflow.",
      "2. Gather the current role targets, validate the configured search keywords, confirm the tracker layout, and normalize any missing metadata before proceeding.",
      "3. Read the scan history, compare it against the tracker, reconcile any duplicates, and prepare a clean worklist before any new dispatch starts.",
      "4. Launch the evaluation workflow, capture the report metadata, verify the output format, and register the result in the tracker only after validation passes.",
      "5. Reconcile the tracker state, merge any additions, rerun verification, and summarize the final outcome once all actions complete successfully.",
    ].join("\n");
    const report = await perfLint(source, "AGENTS.md");
    assert.ok(report.findings.some((f) => f.rule_id === "perf-long-runbook-in-shared-prefix"));
  });

  it("flags redundant prose when a nearby schema already defines the contract", async () => {
    const source = [
      "## Output",
      "",
      "Return JSON with fields `title`, `company`, and `score`.",
      "",
      "- `title`: string",
      "- `company`: string",
      "- `score`: number",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-redundant-schema-prose"));
  });

  it("does not flag generic JSON-only instructions when nearby bullets are not a field contract", async () => {
    const source = [
      "## Working Style",
      "",
      "- Emit structured output when asked. If the orchestrator asks for JSON, return JSON only.",
      "- Stop on blocker. If you hit a schema mismatch, stop and return the error.",
      "- Use `run_actions` for Geometra when possible.",
    ].join("\n");
    const report = await perfLint(source, "iso/agents/general-free.md");
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-redundant-schema-prose"));
  });

  it("does not flag score-emission headings and prose that point at a JSON block", async () => {
    const source = [
      "### Score Emission - EMIT-ONCE JSON (REQUIRED)",
      "",
      "Before writing any report prose, emit the score as a single JSON block.",
      "",
      "```json",
      "{\"weighted_total\": 4.2, \"recommendation\": \"apply\"}",
      "```",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-redundant-schema-prose"));
  });

  it("does not flag label lines that only introduce a fenced JSON example", async () => {
    const source = [
      "**Shape** (emit exactly one block, nothing else in the block):",
      "",
      "```json",
      "{\"weighted_total\": 4.2}",
      "```",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-redundant-schema-prose"));
  });

  it("flags structured output requests that also ask for explanation", async () => {
    const source = "Return JSON with fields `title` and `score`, and explain why you chose the score.";
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-structured-output-explanation"));
  });

  it("flags unnecessary tone instructions on structured outputs", async () => {
    const source = "Return JSON in a friendly, conversational tone.";
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-style-tone-overhead"));
  });

  it("does not flag tone/style guidance that appears inside tables", async () => {
    const source = [
      "| Task | Agent | Why |",
      "| --- | --- | --- |",
      "| Scan portals, extract offer metadata, return structured records (see schema below) | `@general-free` | Structured output; no judgment |",
      "| Cover letter drafts | `@general-paid` | Tone and specificity matter |",
    ].join("\n");
    const report = await perfLint(source, ".cursor/rules/main.mdc");
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-style-tone-overhead"));
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-redundant-schema-prose"));
  });

  it("flags mirrored agent specs once per iso/.opencode pair", async () => {
    const sharedBody = [
      "## Tasks",
      "",
      "- Drive portal workflows with structured outputs and deterministic state transitions that the orchestrator can validate cheaply.",
      "- Emit JSON when asked, stop on blocker, and return only the requested shape so the caller does not need to strip prose.",
      "- Read mode files on demand, avoid duplicate work, and keep retries bounded to one pass before escalating.",
      "",
      "## Working Style",
      "",
      "- Use terse status updates with no preamble and no reflective narration.",
      "- Batch deterministic actions when possible so the orchestrator can keep the top-level session small.",
      "- Return only the requested output shape and keep commentary out of structured responses.",
      "",
      "## Context",
      "",
      "The orchestrator already loaded the shared context and mode files you need for this task, so do not re-read shared sources unless the task explicitly requires a fresh lookup.",
    ].join("\n");
    const report = await runLint(
      [
        {
          rel_path: ".opencode/agents/general-free.md",
          source: [
            "---",
            "description: opencode variant",
            "---",
            "",
            sharedBody,
          ].join("\n"),
        },
        {
          rel_path: "iso/agents/general-free.md",
          source: [
            "---",
            "description: iso variant",
            "---",
            "",
            sharedBody,
          ].join("\n"),
        },
      ],
      cfg,
      { rules: PERFORMANCE_RULES },
    );
    const mirrored = report.findings.filter((f) => f.rule_id === "perf-mirrored-agent-spec");
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0].file, "iso/agents/general-free.md");
  });

  it("deterministically fixes trailing tone/style overhead when the tone phrase is a suffix", async () => {
    const source = "Return JSON in a friendly, conversational tone.";
    const report = await perfLint(source);
    const findings = report.findings.filter((f) => f.rule_id === "perf-style-tone-overhead");
    const fixReport = await computeFixes(
      [{ rel_path: "modes/test.md", source }],
      findings,
      { config: { ...DEFAULT_CONFIG, extends: ["recommended", "performance"] } },
    );
    assert.equal(fixReport.files[0].fixed, "Return JSON.");
  });

  it("flags rationale / post-mortem paragraphs in shared-prefix files", async () => {
    const source = [
      "## Hard Limits",
      "",
      "Rule 1. Max parallel subagents: 2.",
      "",
      "Why: on 2026-04-18, a scan subagent fabricated 30 Greenhouse IDs, the orchestrator dispatched 30 downstream subagents that all hit 404s, and the whole batch had to be rolled back by hand.",
    ].join("\n");
    const report = await perfLint(source, "AGENTS.md");
    assert.ok(report.findings.some((f) => f.rule_id === "perf-rationale-in-shared-prefix"));
  });

  it("flags paragraphs that embed a dated incident narrative", async () => {
    const source = [
      "## Pipeline safety",
      "",
      "Load-bearing facts passed to downstream subagents must come from an authoritative file. On 2025-11-02 a subagent hallucinated plausible-looking Greenhouse IDs and the orchestrator acted on them before anyone noticed, causing a small outage until verification caught it.",
    ].join("\n");
    const report = await perfLint(source, "CLAUDE.md");
    assert.ok(report.findings.some((f) => f.rule_id === "perf-rationale-in-shared-prefix"));
  });

  it("does not flag normal operational paragraphs", async () => {
    const source = [
      "## Rules",
      "",
      "Validate the input schema before saving the result. Emit one JSON block with the score and the rationale.",
    ].join("\n");
    const report = await perfLint(source, "AGENTS.md");
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-rationale-in-shared-prefix"));
  });

  it("skips perf-rationale-in-shared-prefix on agentmd-dialect files", async () => {
    // The exact rationale paragraph that fires in a plain AGENTS.md (see the
    // test above) must NOT fire when the file is in the agentmd dialect —
    // agentmd treats rationale as load-bearing (the model uses it to judge
    // edge cases).
    const ratP = "Why: on 2026-04-18, a scan subagent fabricated 30 Greenhouse IDs, the orchestrator dispatched 30 downstream subagents that all hit 404s, and the whole batch had to be rolled back by hand.";
    const plain = ["## Hard Limits", "", "Rule 1.", "", ratP].join("\n");
    const plainReport = await perfLint(plain, "AGENTS.md");
    assert.ok(
      plainReport.findings.some((f) => f.rule_id === "perf-rationale-in-shared-prefix"),
      "sanity: the rationale paragraph should fire on a plain AGENTS.md",
    );

    const agentmd = [
      "# Agent: outreach-writer",
      "",
      "## Hard limits",
      "",
      "- [H1] Rule 1.",
      "",
      ratP,
    ].join("\n");
    const agentmdReport = await perfLint(agentmd, "AGENTS.md");
    assert.ok(
      !agentmdReport.findings.some((f) => f.rule_id === "perf-rationale-in-shared-prefix"),
      "agentmd-dialect files should be exempt from perf-rationale-in-shared-prefix",
    );
  });

  it("flags sections saturated with MUST / NEVER / CRITICAL emphasis", async () => {
    const source = [
      "## Hard Limits",
      "",
      "Rule 1: MUST never dispatch more than two subagents. This is CRITICAL. The orchestrator MUST NOT fill forms. It SHALL NOT bypass verification under any condition. You MUST ALWAYS clean Geometra sessions before every round — this is MANDATORY. Re-dispatch is STRICTLY forbidden until the previous subagent returns. NEVER append APPLIED to pipeline.md. DO NOT trust prose from a prior subagent. Load-bearing facts are NON-NEGOTIABLE — they come from authoritative files, period.",
    ].join("\n");
    const report = await perfLint(source, "AGENTS.md");
    assert.ok(report.findings.some((f) => f.rule_id === "perf-emphasis-inflation"));
  });

  it("does not flag sections with a few ordinary emphasis markers", async () => {
    const source = [
      "## Working Style",
      "",
      "The orchestrator MUST validate input before each step. Keep responses terse and avoid preamble. When the model hits a blocker, stop and report. Retries are bounded to one pass before escalating. Use structured outputs when asked.",
    ].join("\n");
    const report = await perfLint(source, "modes/scan.md");
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-emphasis-inflation"));
  });

  it("flags paragraphs copy-pasted verbatim across harness files", async () => {
    const duplicateBlock = "Load-bearing facts passed to downstream subagents must come from an authoritative file, not from a prior subagent's prose. URLs, scores, and IDs must originate from pipeline.md, scan-history.tsv, or a report with authoritative headers.";
    const report = await runLint(
      [
        { rel_path: "modes/apply.md", source: `## Facts\n\n${duplicateBlock}\n` },
        { rel_path: "modes/scan.md", source: `## Facts\n\n${duplicateBlock}\n` },
      ],
      cfg,
      { rules: PERFORMANCE_RULES },
    );
    const cross = report.findings.filter((f) => f.rule_id === "perf-cross-file-duplicate-block");
    assert.equal(cross.length, 1);
    assert.equal(cross[0].file, "modes/scan.md");
  });

  it("does not flag cross-file duplicates when a paragraph is under the word threshold", async () => {
    const report = await runLint(
      [
        { rel_path: "modes/apply.md", source: "## Facts\n\nShort shared line.\n" },
        { rel_path: "modes/scan.md", source: "## Facts\n\nShort shared line.\n" },
      ],
      cfg,
      { rules: PERFORMANCE_RULES },
    );
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-cross-file-duplicate-block"));
  });

  it("flags runs of 3+ prohibition sentences in prose", async () => {
    const source = [
      "## Rules",
      "",
      "Do not call the API directly. Do not skip validation. Never retry on 4xx errors. Must not log the raw payload.",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(report.findings.some((f) => f.rule_id === "perf-dense-prohibition-list"));
  });

  it("does not flag a single prohibition or two scattered prohibitions", async () => {
    const source = [
      "## Rules",
      "",
      "Validate the input before saving. Never trust subagent prose. Emit the score as one JSON block.",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-dense-prohibition-list"));
  });

  it("flags conditional branches on a discovered mode name in shared prefixes", async () => {
    const sharedSource = [
      "## Mode routing",
      "",
      "If you're running the scan mode, read scan-history.tsv and prepare the worklist before dispatching.",
      "",
      "When the orchestrator dispatches an `apply`, pick the subagent based on the table below.",
    ].join("\n");
    const report = await runLint(
      [
        { rel_path: "AGENTS.md", source: sharedSource },
        { rel_path: "modes/scan.md", source: "## Scan\n\nRead the pipeline.\n" },
        { rel_path: "modes/apply.md", source: "## Apply\n\nFill the form.\n" },
      ],
      cfg,
      { rules: PERFORMANCE_RULES },
    );
    const hits = report.findings.filter((f) => f.rule_id === "perf-conditional-mode-branch-in-shared-prefix");
    assert.equal(hits.length, 2);
    const names = hits.map((f) => f.message.match(/`([^`]+)`/)?.[1]).sort();
    assert.deepEqual(names, ["apply", "scan"]);
  });

  it("does not flag ordinary nouns that happen to collide with mode names", async () => {
    const sharedSource = [
      "## Working notes",
      "",
      "If the candidate receives an offer, record it in the tracker before responding.",
      "",
      "Read cv.md and article-digest.md before evaluating any offer.",
      "",
      "When generating English text for PDF summaries, keep sentences short.",
    ].join("\n");
    const report = await runLint(
      [
        { rel_path: "AGENTS.md", source: sharedSource },
        { rel_path: "modes/offer.md", source: "## Offer\n\nVerify.\n" },
        { rel_path: "modes/pdf.md", source: "## PDF\n\nGenerate.\n" },
      ],
      cfg,
      { rules: PERFORMANCE_RULES },
    );
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-conditional-mode-branch-in-shared-prefix"));
  });

  it("does not fire when no modes/ files are discovered", async () => {
    const report = await runLint(
      [{ rel_path: "AGENTS.md", source: "When running the scan mode, do X.\n" }],
      cfg,
      { rules: PERFORMANCE_RULES },
    );
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-conditional-mode-branch-in-shared-prefix"));
  });

  it("flags sentences with 3+ nested conditionals", async () => {
    const source = [
      "## Routing",
      "",
      "If the orchestrator is running and when the subagent returns a score, unless the score is below threshold, emit JSON.",
    ].join("\n");
    const report = await perfLint(source);
    const hits = report.findings.filter((f) => f.rule_id === "perf-nested-conditional-chain");
    assert.ok(hits.length >= 1);
    assert.ok(/3 conditionals/.test(hits[0].message) || /4 conditionals/.test(hits[0].message));
  });

  it("does not flag sentences with a single conditional", async () => {
    const source = [
      "## Routing",
      "",
      "If the score is above threshold, emit JSON. Otherwise, skip.",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-nested-conditional-chain"));
  });

  it("does not flag conditionals inside tables or headings", async () => {
    const source = [
      "## When to act and if the score matters and unless overridden",
      "",
      "| Case | If Score | When Flag | Unless Paid |",
      "| --- | --- | --- | --- |",
      "| A | yes | yes | no |",
    ].join("\n");
    const report = await perfLint(source);
    assert.ok(!report.findings.some((f) => f.rule_id === "perf-nested-conditional-chain"));
  });

  it("uses LLM rewrites for performance findings when the performance preset is enabled", async () => {
    const source = [
      "## Step 1",
      "",
      "Return JSON with fields `name` and `score`.",
      "",
      "## Step 2",
      "",
      "Return JSON with fields `name` and `score`.",
    ].join("\n");
    const report = await perfLint(source);
    const findings = report.findings.filter((f) => f.rule_id === "perf-duplicated-output-requirement");
    assert.equal(findings.length, 1);
    const model = new MockProvider("perf-rewriter", () => "Use the existing JSON format from Step 1.");
    const fixReport = await computeFixes(
      [{ rel_path: "modes/test.md", source }],
      findings,
      {
        use_llm: true,
        model,
        config: { ...DEFAULT_CONFIG, extends: ["recommended", "performance"] },
      },
    );
    assert.ok(fixReport.files[0].fixed.includes("Use the existing JSON format from Step 1."));
  });
});

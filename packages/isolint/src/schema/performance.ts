import type { Severity } from "../lint/types.js";
import type { JSONSchema, OutputFormat, Plan, Step } from "./plan.js";

export interface PlanPerformanceFinding {
  rule_id: string;
  severity: Severity;
  path: string;
  message: string;
  snippet?: string;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "based", "be", "by", "for", "from",
  "given", "if", "in", "into", "is", "it", "of", "on", "only", "or", "the",
  "their", "then", "this", "to", "use", "using", "with",
]);

const ACTION_CUE_RE = /\b(return|extract|classify|identify|compute|validate|propose|assemble|read|choose|score|summarize|map|filter|compare|format|select|write)\b/gi;
const STYLE_TONE_RE = /\b(friendly|professional|warm|conversational|empathetic|persuasive|confident|approachable|tone|voice|style|human(?:-sounding)?|natural)\b/i;
const EXPLANATION_RE = /\b(explain|explanation|justify|justification|reasoning|rationale|analysis|why)\b/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$steps\.[a-z0-9_-]+/g, "$steps")
    .replace(/\$input(?:\.[a-z0-9_.-]+)?/g, "$input")
    .replace(/[^a-z0-9$_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap++;
  }
  return overlap / (setA.size + setB.size - overlap);
}

function wordCount(text: string): number {
  return text.match(/[A-Za-z0-9$_.-]+/g)?.length ?? 0;
}

function pathForStep(index: number, field: keyof Step): string {
  return `steps[${index}].${field}`;
}

function finding(
  rule_id: string,
  severity: Severity,
  path: string,
  message: string,
  snippet?: string,
): PlanPerformanceFinding {
  return { rule_id, severity, path, message, ...(snippet ? { snippet } : {}) };
}

function outputFormatMentions(step: Step): boolean {
  const instruction = step.instruction;
  switch (step.expected_output.kind) {
    case "json":
      return /\b(return|output|emit|produce|provide)\s+(?:a\s+)?json\b|\bjson object\b|\bjson array\b/i.test(instruction);
    case "list":
      return /\b(return|output|emit|produce|provide)\s+(?:a\s+)?(?:json\s+)?(?:array|list)\b/i.test(instruction);
    case "enum":
      return false;
    case "text":
      return false;
  }
}

function propertyNames(schema: JSONSchema): string[] {
  const props = schema.properties ?? {};
  return Object.keys(props);
}

function listInnerFormat(format: OutputFormat): OutputFormat {
  return format.kind === "list" ? format.item_format : format;
}

function stepHasStructuredOutput(step: Step): boolean {
  return step.expected_output.kind !== "text";
}

function schemaHasProperties(step: Step): string[] {
  const format = listInnerFormat(step.expected_output);
  if (format.kind !== "json") return [];
  return propertyNames(format.json_schema);
}

function mentionsSchemaProperties(instruction: string, properties: string[]): number {
  const norm = normalize(instruction);
  let count = 0;
  for (const property of properties) {
    if (norm.includes(property.toLowerCase())) count++;
  }
  return count;
}

function hasLowSignalLongInstruction(step: Step): boolean {
  const words = wordCount(step.instruction);
  if (words < 35) return false;
  const cues = (step.instruction.match(ACTION_CUE_RE) ?? []).length
    + (step.instruction.match(/\$input|\$steps\.|json|enum|list|regex|schema|exactly|at most|at least|\d+/gi) ?? []).length;
  return words >= 50 || cues < Math.ceil(words / 18);
}

function redundantConstraint(step: Step): boolean {
  if (step.expected_output.kind !== "json") return false;
  const schema = step.expected_output.json_schema;
  const props = schema.properties ?? {};
  const hasNumberProperty = Object.values(props).some((p) => p.type === "number" || p.type === "integer");
  if (!hasNumberProperty) return false;
  return step.constraints.some((constraint) => /\bjson numbers?\b|\bnot strings?\b|\binteger\b/i.test(constraint.rule));
}

export function lintPlanPerformance(plan: Plan): PlanPerformanceFinding[] {
  const findings: PlanPerformanceFinding[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const instructionPath = pathForStep(i, "instruction");

    if (hasLowSignalLongInstruction(step)) {
      findings.push(
        finding(
          "perf-plan-long-instruction",
          "info",
          instructionPath,
          "Instruction is long relative to the work it defines. Move wire-format and validation details into expected_output or constraints.",
          step.instruction,
        ),
      );
    }

    if (outputFormatMentions(step)) {
      findings.push(
        finding(
          "perf-plan-duplicated-output-contract",
          "info",
          instructionPath,
          "Instruction repeats the output format already declared in expected_output. Keep the task here; let expected_output define the wire format.",
          step.instruction,
        ),
      );
    }

    const properties = schemaHasProperties(step);
    if (
      properties.length >= 2
      && /\b(fields|keys|properties|json object|json array)\b/i.test(step.instruction)
      && mentionsSchemaProperties(step.instruction, properties) >= 2
    ) {
      findings.push(
        finding(
          "perf-plan-redundant-schema-prose",
          "info",
          instructionPath,
          "Instruction restates a JSON contract that is already encoded in expected_output.json_schema. Keep one source of truth.",
          step.instruction,
        ),
      );
    }

    if (stepHasStructuredOutput(step) && EXPLANATION_RE.test(step.instruction)) {
      findings.push(
        finding(
          "perf-plan-structured-output-explanation",
          "warn",
          instructionPath,
          "Structured outputs should not also ask for explanation unless a downstream consumer needs it explicitly. Explanations add tokens and latency.",
          step.instruction,
        ),
      );
    }

    if (stepHasStructuredOutput(step) && STYLE_TONE_RE.test(step.instruction)) {
      findings.push(
        finding(
          "perf-plan-style-tone-overhead",
          "info",
          instructionPath,
          "Tone/style guidance on a structured output usually adds prompt cost without changing execution.",
          step.instruction,
        ),
      );
    }

    if (redundantConstraint(step)) {
      findings.push(
        finding(
          "perf-plan-redundant-constraint",
          "info",
          pathForStep(i, "constraints"),
          "A constraint repeats numeric typing already enforced by expected_output.json_schema.",
        ),
      );
    }
  }

  for (let i = 1; i < plan.steps.length; i++) {
    const current = plan.steps[i];
    const currentNorm = normalize(current.instruction);
    const currentTokens = tokens(current.instruction);
    let bestIndex = -1;
    let bestScore = 0;

    for (let j = 0; j < i; j++) {
      const prior = plan.steps[j];
      const priorNorm = normalize(prior.instruction);
      const score = Math.max(
        currentNorm === priorNorm ? 1 : 0,
        currentNorm.includes(priorNorm) || priorNorm.includes(currentNorm) ? 0.92 : 0,
        jaccard(currentTokens, tokens(prior.instruction)),
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = j;
      }
    }

    if (bestIndex !== -1 && bestScore >= 0.82) {
      findings.push(
        finding(
          "perf-plan-restated-step",
          "warn",
          pathForStep(i, "instruction"),
          `This step mostly restates steps[${bestIndex}].instruction. Merge them or make the later step do distinct work.`,
          current.instruction,
        ),
      );
    }
  }

  return findings;
}

export function formatPlanPerformance(findings: PlanPerformanceFinding[]): string {
  if (findings.length === 0) return "performance: no findings";

  const sorted = [...findings].sort(
    (a, b) => a.path.localeCompare(b.path) || a.rule_id.localeCompare(b.rule_id),
  );

  const lines: string[] = ["performance findings:"];
  for (const finding of sorted) {
    lines.push(`  ${finding.severity.padEnd(5)} ${finding.rule_id.padEnd(38)} ${finding.path} ${finding.message}`);
    if (finding.snippet) {
      lines.push(`           in: "${truncate(finding.snippet, 160)}"`);
    }
  }

  const warn = findings.filter((f) => f.severity === "warn").length;
  const info = findings.filter((f) => f.severity === "info").length;
  const parts: string[] = [];
  if (warn) parts.push(`${warn} warning${warn === 1 ? "" : "s"}`);
  if (info) parts.push(`${info} info`);
  lines.push(``);
  lines.push(`summary: ${parts.join(", ")}`);
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

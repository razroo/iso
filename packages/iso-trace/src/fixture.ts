import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRedactor, type RedactionOptions } from "./redact.js";
import type { FileOpEvent, Session } from "./types.js";
import { iterateEvents } from "./query.js";

export interface FixtureExportResult {
  outDir: string;
  taskMdPath: string;
  workspaceDir: string;
  checksYmlPath: string;
  readFiles: string[];
  writtenFiles: string[];
  editedFiles: string[];
}

export interface ExportFixtureOptions {
  /** Absolute or relative directory to write the fixture into. */
  out: string;
  /** Runner to persist in the generated eval suite. Defaults to fake. */
  runner?: "fake" | "codex" | "claude-code" | "cursor" | "opencode";
  /** Optional harness.source path to persist in the generated eval suite. */
  harnessSource?: string;
  /** How edits should be represented in generated checks. Defaults to placeholder. */
  editChecks?: "placeholder" | "exists-only";
  /** Optional redaction pass applied to exported text and paths. */
  redact?: RedactionOptions;
}

/**
 * Lift a captured session into a fixture that an iso-eval suite can consume.
 *
 * The fixture layout mirrors what iso-eval's `loadSuite` + `Task` expects:
 *
 *   <out>/
 *   ├── task.md       — the first user prompt, verbatim
 *   ├── workspace/    — baseline files the agent read (content left empty;
 *   │                   maintainer fills in what the agent was seeing)
 *   └── checks.yml    — one file_exists per write, file_exists + a
 *                       placeholder file_contains per edit
 *
 * The output is a *seed*, not a perfect replay — iso-trace can't know the
 * agent's input workspace or what "success" should assert. Maintainers
 * edit these files before dropping the fixture into a suite.
 */
export function exportFixture(session: Session, opts: ExportFixtureOptions): FixtureExportResult {
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const redactor = opts.redact ? createRedactor(session, opts.redact) : undefined;

  const taskMdPath = join(outDir, "task.md");
  writeFileSync(taskMdPath, renderTaskMd(session, redactor));

  const workspaceDir = join(outDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });

  // Sort so generated fixtures are deterministic for snapshot testing.
  const reads = new Set<string>();
  const writes = new Set<string>();
  const edits = new Set<string>();
  for (const { event } of iterateEvents(session)) {
    if (event.kind !== "file_op") continue;
    const e = event as FileOpEvent;
    if (e.op === "read") reads.add(e.path);
    else if (e.op === "write") writes.add(e.path);
    else if (e.op === "edit") edits.add(e.path);
  }

  // Seed the workspace with empty placeholders for files the agent read.
  // Maintainers replace these with the real baseline content before shipping
  // the fixture. Skipping absolute paths outside the session cwd keeps the
  // fixture self-contained.
  for (const p of [...reads].sort()) {
    const rel = relativeToCwd(p, session.cwd);
    if (!rel) continue;
    const safeRel = redactor ? redactor.text(rel) : rel;
    const abs = join(workspaceDir, safeRel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "");
  }

  const checksYmlPath = join(outDir, "checks.yml");
  writeFileSync(
    checksYmlPath,
    renderChecksYml(session, [...writes], [...edits], {
      runner: opts.runner ?? "fake",
      harnessSource: opts.harnessSource,
      editChecks: opts.editChecks ?? "placeholder",
      redactor,
    }),
  );

  return {
    outDir,
    taskMdPath,
    workspaceDir,
    checksYmlPath,
    readFiles: mapPaths([...reads].sort(), session.cwd, redactor),
    writtenFiles: mapPaths([...writes].sort(), session.cwd, redactor),
    editedFiles: mapPaths([...edits].sort(), session.cwd, redactor),
  };
}

function renderTaskMd(session: Session, redactor?: ReturnType<typeof createRedactor>): string {
  const firstUser = findFirstUserMessage(session);
  const header =
    `# Task (exported from iso-trace session ${session.id})\n\n` +
    `<!-- Source: ${session.source.harness} transcript at ${redactor ? redactor.text(session.source.path) : session.source.path} -->\n\n`;
  if (!firstUser) {
    return `${header}TODO: no user message found in this session — fill in the task prompt manually.\n`;
  }
  return `${header}${(redactor ? redactor.text(firstUser) : firstUser).trim()}\n`;
}

function findFirstUserMessage(session: Session): string | null {
  for (const { event } of iterateEvents(session)) {
    if (event.kind === "message" && event.role === "user") {
      const text = event.text.trim();
      if (text) return text;
    }
  }
  return null;
}

function renderChecksYml(
  session: Session,
  writes: string[],
  edits: string[],
  opts: {
    runner: "fake" | "codex" | "claude-code" | "cursor" | "opencode";
    harnessSource?: string;
    editChecks: "placeholder" | "exists-only";
    redactor?: ReturnType<typeof createRedactor>;
  },
): string {
  const lines: string[] = [];
  lines.push(`# Seed suite for fixture exported from iso-trace session ${session.id}.`);
  if (opts.editChecks === "placeholder") {
    lines.push(`# Review the checks below — iso-trace emits file_exists per write and`);
    lines.push(`# file_exists + a placeholder file_contains per edit. Replace the`);
    lines.push(`# "REPLACE_ME" strings with the actual value you want to assert.`);
  } else {
    lines.push(`# Review the checks below — iso-trace emits file_exists per write and edit.`);
    lines.push(`# Tighten edit assertions later if you want content-level regressions.`);
  }
  lines.push(``);
  lines.push(`suite: fixture-${session.id}`);
  lines.push(`runner: ${opts.runner}`);
  if (opts.harnessSource) {
    lines.push(`harness:`);
    lines.push(`  source: ${yamlString(opts.harnessSource)}`);
  }
  lines.push(``);
  lines.push(`tasks:`);
  lines.push(`  - id: exported-task`);
  lines.push(`    prompt: task.md`);
  lines.push(`    workspace: workspace/`);
  lines.push(`    checks:`);
  if (writes.length === 0 && edits.length === 0) {
    lines.push(`      # No file writes or edits observed in this session.`);
    lines.push(`      # Add assertions manually before running \`iso-eval\` against this suite.`);
    lines.push(`      # - { type: command, run: "true", expectExit: 0 }`);
  }
  for (const p of writes.sort()) {
    const rel = opts.redactor
      ? opts.redactor.text(relativeToCwd(p, session.cwd) ?? p)
      : relativeToCwd(p, session.cwd) ?? p;
    lines.push(`      - { type: file_exists, path: ${yamlString(rel)} }`);
  }
  for (const p of edits.sort()) {
    const rel = opts.redactor
      ? opts.redactor.text(relativeToCwd(p, session.cwd) ?? p)
      : relativeToCwd(p, session.cwd) ?? p;
    lines.push(`      - { type: file_exists, path: ${yamlString(rel)} }`);
    if (opts.editChecks === "placeholder") {
      lines.push(`      - { type: file_contains, path: ${yamlString(rel)}, value: "REPLACE_ME" }`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}

function relativeToCwd(absOrRel: string, cwd: string): string | null {
  if (!absOrRel) return null;
  // Already relative? Keep as-is.
  if (!absOrRel.startsWith("/")) return absOrRel;
  const normCwd = cwd.replace(/\/+$/, "");
  if (!normCwd) return null;
  if (absOrRel === normCwd) return "";
  if (absOrRel.startsWith(normCwd + "/")) return absOrRel.slice(normCwd.length + 1);
  return null;
}

function yamlString(s: string): string {
  // Only quote when needed — paths like `out/file.txt` don't need quotes.
  if (/^[a-zA-Z0-9_\-./]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function mapPaths(
  paths: string[],
  cwd: string,
  redactor?: ReturnType<typeof createRedactor>,
): string[] {
  return paths.map((path) => {
    const rel = relativeToCwd(path, cwd) ?? path;
    return redactor ? redactor.text(rel) : rel;
  });
}

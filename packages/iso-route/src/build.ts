import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadPolicy } from "./parser.js";
import { emitClaude } from "./targets/claude.js";
import { emitCodex } from "./targets/codex.js";
import { emitCursor } from "./targets/cursor.js";
import { emitOpenCode } from "./targets/opencode.js";
import type { BuildResult, EmitResult, HarnessTarget, ModelPolicy } from "./types.js";

export const ALL_TARGETS: HarnessTarget[] = ["claude", "codex", "opencode", "cursor"];

export interface BuildOptions {
  source: string;
  out: string;
  targets?: HarnessTarget[];
  dryRun?: boolean;
}

export function build(opts: BuildOptions): BuildResult {
  const policy = loadPolicy(opts.source);
  const targets = opts.targets ?? ALL_TARGETS;
  const outDir = resolve(opts.out);
  const emits: EmitResult[] = [];
  for (const t of targets) emits.push(emitFor(t, policy));

  if (!opts.dryRun) {
    for (const e of emits) {
      for (const f of e.files) {
        const full = resolve(outDir, f.path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, f.contents);
      }
    }
  }

  const warnings = emits.flatMap((e) => e.warnings);
  return { policy, emits, warnings };
}

function emitFor(target: HarnessTarget, policy: ModelPolicy): EmitResult {
  switch (target) {
    case "claude":
      return emitClaude(policy);
    case "codex":
      return emitCodex(policy);
    case "opencode":
      return emitOpenCode(policy);
    case "cursor":
      return emitCursor(policy);
  }
}

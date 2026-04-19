#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_TARGETS, build } from "./build.js";
import { listPresets, loadPolicy } from "./parser.js";
import type { HarnessTarget } from "./types.js";

const USAGE = `iso-route — one model policy, every harness

usage:
  iso-route --version | -v
  iso-route --help | -h
  iso-route build  <models.yaml> [--out <dir>] [--targets claude,codex,opencode,cursor]
                                  [--dry-run]
  iso-route plan   <models.yaml>
  iso-route init   [--preset <name>] [--out <path>] [--force]

targets default to all four. --dry-run emits nothing but prints every file it *would* write.
"init" scaffolds a starter models.yaml from a built-in preset. Run "iso-route init --help"
to see available presets.
`;

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function parseTargets(s: string): HarnessTarget[] {
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const out: HarnessTarget[] = [];
  for (const p of parts) {
    if (!ALL_TARGETS.includes(p as HarnessTarget)) {
      throw new Error(
        `unknown target "${p}" — valid: ${ALL_TARGETS.join(", ")}`,
      );
    }
    out.push(p as HarnessTarget);
  }
  if (!out.length) throw new Error("--targets must list at least one target");
  return out;
}

function cmdBuild(args: string[]): number {
  if (args.length === 0) {
    console.error("iso-route build: missing <models.yaml> path");
    return 2;
  }
  const source = args[0];
  let out = ".";
  let targets: HarnessTarget[] | undefined;
  let dryRun = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") {
      out = args[++i] ?? "";
      if (!out) {
        console.error("iso-route build: --out requires a directory");
        return 2;
      }
    } else if (a === "--targets") {
      targets = parseTargets(args[++i] ?? "");
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      console.error(`iso-route build: unknown flag "${a}"`);
      return 2;
    }
  }

  const result = build({ source, out, targets, dryRun });
  const verb = dryRun ? "would write" : "wrote";
  console.log(
    `iso-route: loaded default (${result.policy.default.provider}/${result.policy.default.model}) + ${result.policy.roles.length} role(s) from ${result.policy.sourcePath}`,
  );
  let totalFiles = 0;
  let totalBytes = 0;
  for (const e of result.emits) {
    console.log(`  [${e.target}] ${verb} ${e.files.length} file(s)`);
    for (const f of e.files) {
      totalFiles++;
      totalBytes += f.bytes;
      console.log(`    - ${f.path} (${formatBytes(f.bytes)})`);
    }
  }
  if (result.warnings.length) {
    console.log("");
    for (const w of result.warnings) console.log(`  warning: ${w}`);
  }
  if (dryRun) {
    console.log(`\n${totalFiles} file(s), ${formatBytes(totalBytes)} — no files written`);
  }
  return 0;
}

function cmdPlan(args: string[]): number {
  if (args.length === 0) {
    console.error("iso-route plan: missing <models.yaml> path");
    return 2;
  }
  const policy = loadPolicy(args[0]);
  console.log(`source:   ${policy.sourcePath}`);
  console.log(`default:  ${policy.default.provider}/${policy.default.model}${policy.default.reasoning ? ` (reasoning: ${policy.default.reasoning})` : ""}`);
  console.log(`roles:    ${policy.roles.length}`);
  for (const r of policy.roles) {
    const fb = r.fallback?.length
      ? ` → fallback [${r.fallback.map((f) => `${f.provider}/${f.model}`).join(" → ")}]`
      : "";
    const reasoning = r.reasoning ? ` (reasoning: ${r.reasoning})` : "";
    console.log(`  - ${r.name}: ${r.provider}/${r.model}${reasoning}${fb}`);
  }
  return 0;
}

function cmdInit(args: string[]): number {
  let preset = "standard";
  let outPath = "models.yaml";
  let force = false;
  let showHelp = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--preset") {
      preset = args[++i] ?? "";
      if (!preset) {
        console.error("iso-route init: --preset requires a name");
        return 2;
      }
    } else if (a === "--out") {
      outPath = args[++i] ?? "";
      if (!outPath) {
        console.error("iso-route init: --out requires a path");
        return 2;
      }
    } else if (a === "--force") {
      force = true;
    } else if (a === "--help" || a === "-h") {
      showHelp = true;
    } else {
      console.error(`iso-route init: unknown flag "${a}"`);
      return 2;
    }
  }
  if (showHelp) {
    console.log(
      `iso-route init — scaffold a models.yaml from a built-in preset\n\n` +
        `available presets: ${listPresets().join(", ")}\n\n` +
        `flags:\n` +
        `  --preset <name>  preset to use (default: standard)\n` +
        `  --out <path>     where to write (default: ./models.yaml)\n` +
        `  --force          overwrite an existing file\n`,
    );
    return 0;
  }

  const presets = listPresets();
  if (!presets.includes(preset)) {
    console.error(
      `iso-route init: unknown preset "${preset}". Available: ${presets.join(", ")}`,
    );
    return 2;
  }

  const absOut = resolve(process.cwd(), outPath);
  if (existsSync(absOut) && !force) {
    console.error(
      `iso-route init: ${absOut} already exists. Pass --force to overwrite, or --out <other>.`,
    );
    return 2;
  }

  // Scaffold a lean consumer models.yaml that extends the preset. Users can
  // see the preset's content by reading node_modules/@razroo/iso-route/presets/
  // or by running `iso-route plan` on this file.
  const header = `# Model policy for this project. Extends @razroo/iso-route's built-in "${preset}"\n`;
  const explain =
    `# preset — override only what you want to differ. Run \`iso-route plan\` to see\n` +
    `# the resolved policy (preset + your overrides applied).\n`;
  const body = `\nextends: ${preset}\n\n# Example override — uncomment and edit:\n#\n# roles:\n#   quality:\n#     targets:\n#       codex:\n#         provider: openai\n#         model: gpt-5.4\n`;
  writeFileSync(absOut, header + explain + body);
  console.log(`iso-route: wrote ${absOut} (extends preset "${preset}")`);
  console.log(`  next: \`iso-route plan ${outPath}\` to see resolved roles`);
  console.log(`        \`iso-route build ${outPath} --out .\` to emit harness configs`);
  return 0;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(readVersion());
    return 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);
  if (cmd === "build") return cmdBuild(rest);
  if (cmd === "plan") return cmdPlan(rest);
  if (cmd === "init") return cmdInit(rest);
  console.error(`iso-route: unknown command "${cmd}"\n`);
  console.error(USAGE);
  return 2;
}

try {
  process.exit(main(process.argv));
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`iso-route: ${msg}`);
  process.exit(1);
}

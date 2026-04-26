import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export function findMatchingFiles(root: string, include: string[], exclude: string[] = []): string[] {
  const normalizedRoot = resolve(root);
  const excludeRegexes = exclude.map(globToRegExp);
  const seen = new Set<string>();

  for (const pattern of include) {
    const base = globBase(normalizedRoot, pattern);
    if (!existsSync(base)) continue;
    const includeRegex = globToRegExp(pattern);
    for (const file of listFiles(base)) {
      const rel = toPosix(relative(normalizedRoot, file));
      if (includeRegex.test(rel) && !excludeRegexes.some((regex) => regex.test(rel))) {
        seen.add(resolve(file));
      }
    }
  }

  return [...seen].sort((a, b) => toPosix(relative(normalizedRoot, a)).localeCompare(toPosix(relative(normalizedRoot, b))));
}

function listFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    if (entry === ".git" || entry === "node_modules") continue;
    out.push(...listFiles(join(path, entry)));
  }
  return out;
}

function globBase(root: string, pattern: string): string {
  const normalized = toPosix(pattern);
  const wildcard = normalized.search(/[*?\[]/);
  if (wildcard === -1) return resolve(root, normalized);
  const prefix = normalized.slice(0, wildcard);
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : dirname(prefix);
  return resolve(root, base === "." ? "" : base);
}

function globToRegExp(pattern: string): RegExp {
  const input = toPosix(pattern);
  let out = "^";
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      i++;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegex(char);
    }
  }
  out += "$";
  return new RegExp(out);
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function escapeRegex(char: string): string {
  return /[\\^$+?.()|{}[\]]/.test(char) ? `\\${char}` : char;
}

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export interface DiscoveredFile {
  abs_path: string;
  rel_path: string;
  source: string;
}

export interface DiscoverOptions {
  ignore: string[];
  /** Honor rules from .gitignore / .git/info/exclude / global excludes. Default true. */
  use_gitignore?: boolean;
}

interface GitAllowlist {
  files: Set<string>;
  dirs: Set<string>;
}

function realpathOrResolve(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

/**
 * Ask git for the set of files in `root`'s repo that are tracked OR
 * untracked-but-not-ignored. Returns null if `root` isn't in a git repo
 * or git isn't available. Paths are absolute.
 */
function gitAllowlist(root: string): GitAllowlist | null {
  let repoRoot: string;
  try {
    repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  } catch {
    return null;
  }
  const files = new Set<string>();
  for (const p of raw.split("\0")) {
    if (!p) continue;
    files.add(resolve(repoRoot, p));
  }
  const dirs = new Set<string>();
  for (const f of files) {
    let d = dirname(f);
    while (d && !dirs.has(d)) {
      dirs.add(d);
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
  }
  return { files, dirs };
}

/**
 * Walk a directory tree once and return every repo-relative file path.
 * Honors the same ignore globs as discoverFiles. Used by rules that need
 * to verify cross-file references (e.g. `missing-file-reference`).
 */
export function discoverRepoFiles(
  root: string,
  opts: DiscoverOptions,
): Set<string> {
  const rootAbs = realpathOrResolve(root);
  const ignoreMatchers = opts.ignore.map(globToRegExp);
  const allow = opts.use_gitignore === false ? null : gitAllowlist(rootAbs);
  const out = new Set<string>();

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = resolve(dir, name);
      const rel = relative(rootAbs, abs);
      if (ignoreMatchers.some((re) => re.test(rel) || re.test(rel + "/"))) continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (allow && !allow.dirs.has(abs)) continue;
        walk(abs);
      } else if (st.isFile()) {
        if (allow && !allow.files.has(abs)) continue;
        out.add(rel);
      }
    }
  }

  try {
    const st = statSync(rootAbs);
    if (st.isDirectory()) walk(rootAbs);
    else if (st.isFile()) out.add(relative(rootAbs, rootAbs) || rootAbs.split("/").pop() || "");
  } catch {
    // root doesn't exist — nothing to do.
  }
  return out;
}

/**
 * Walk a directory tree and return all matching files.
 * Honors ignore globs (simple glob: *, **, ? and literal segments) and,
 * by default, .gitignore rules when inside a git repo.
 */
export function discoverFiles(
  root: string,
  opts: { include_ext: string[] } & DiscoverOptions,
): DiscoveredFile[] {
  const rootAbs = realpathOrResolve(root);
  const results: DiscoveredFile[] = [];
  const ignoreMatchers = opts.ignore.map(globToRegExp);

  const stat = statSync(rootAbs);
  if (stat.isFile()) {
    // Single explicit file: user named it, so gitignore doesn't apply.
    const source = readFileSync(rootAbs, "utf8");
    results.push({ abs_path: rootAbs, rel_path: rootAbs.split("/").pop() ?? "", source });
    return results;
  }

  const allow = opts.use_gitignore === false ? null : gitAllowlist(rootAbs);

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = resolve(dir, name);
      const rel = relative(rootAbs, abs);
      if (ignoreMatchers.some((re) => re.test(rel) || re.test(rel + "/"))) continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (allow && !allow.dirs.has(abs)) continue;
        walk(abs);
      } else if (st.isFile()) {
        if (allow && !allow.files.has(abs)) continue;
        const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
        if (opts.include_ext.includes(ext)) {
          let source: string;
          try {
            source = readFileSync(abs, "utf8");
          } catch {
            continue;
          }
          results.push({ abs_path: abs, rel_path: rel, source });
        }
      }
    }
  }

  walk(rootAbs);
  return results;
}

/**
 * Convert a simple glob pattern to a RegExp. Supports:
 *  - `**` matches any number of path segments (including zero)
 *  - `*`  matches any characters except `/`
 *  - `?`  matches a single character except `/`
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+^$()|{}[]\\.".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

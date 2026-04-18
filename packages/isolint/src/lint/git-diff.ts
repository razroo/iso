/**
 * Support for `isolint lint --since <ref>`.
 *
 * Returns the set of repo-relative paths touched since `ref`:
 *   - Commits since the merge-base (`ref...HEAD`)
 *   - Unstaged + staged working-tree changes against HEAD
 *   - Untracked files not in .gitignore
 *
 * Paths are normalized to absolute. Deleted files are excluded.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Resolves the repository root for a given starting path. Returns null when
 * the path isn't inside a git repo or git isn't available.
 */
export function findGitRoot(start: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * Return absolute paths of files changed since `ref` — committed diffs,
 * working-tree changes, and untracked files — deduped and existing-only.
 */
export function changedFilesSince(repoRoot: string, ref: string): Set<string> {
  const paths = new Set<string>();
  const add = (raw: string): void => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) paths.add(resolve(repoRoot, trimmed));
    }
  };

  // Committed diffs from ref to HEAD (added/copied/modified/renamed — skip deleted).
  try {
    add(runGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMR", `${ref}...HEAD`]));
  } catch (err) {
    throw new Error(
      `git diff against "${ref}" failed — is it a valid ref? (${(err as Error).message.split("\n")[0]})`,
    );
  }

  // Working-tree changes against HEAD (staged + unstaged).
  try {
    add(runGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]));
  } catch {
    // Empty repo / no HEAD — ignore.
  }

  // Untracked files (excludes .gitignored).
  try {
    add(runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]));
  } catch {
    // Non-fatal.
  }

  return paths;
}

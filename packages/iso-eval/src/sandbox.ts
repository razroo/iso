import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Snapshot {
  dir: string;
  cleanup: () => void;
}

export function snapshotWorkspace(srcDir: string, taskId: string): Snapshot {
  if (!existsSync(srcDir)) {
    throw new Error(`workspace source does not exist: ${srcDir}`);
  }
  const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const base = mkdtempSync(join(tmpdir(), `iso-eval-${safeId}-`));
  const dest = join(base, "workspace");
  cpSync(srcDir, dest, { recursive: true });
  return {
    dir: dest,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — don't fail the run on stray fs handles
      }
    },
  };
}

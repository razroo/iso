import { cpSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { SpawnSyncReturns } from "node:child_process";

export type SyncSpawnResult = Pick<
  SpawnSyncReturns<string>,
  "status" | "signal" | "stdout" | "stderr" | "error"
>;

export function copyFile(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { force: true });
}

export function copyDir(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

export function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}

export function normaliseExitCode(result: SyncSpawnResult): number {
  if (typeof result.status === "number") return result.status;
  if (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") return 124;
  return result.signal ? 1 : 0;
}

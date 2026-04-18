import { spawnSync } from "node:child_process";
import type { CheckResult, CommandCheck } from "../types.js";

export function runCommandCheck(
  check: CommandCheck,
  workspaceDir: string,
): CheckResult {
  const r = spawnSync("sh", ["-c", check.run], {
    cwd: workspaceDir,
    encoding: "utf8",
    timeout: check.timeoutMs,
  });
  const exitCode = r.status ?? (r.signal ? -1 : 0);
  const expectExit = check.expectExit ?? 0;
  const stdout = r.stdout ?? "";
  const failures: string[] = [];

  if (exitCode !== expectExit) {
    failures.push(`exit ${exitCode}, expected ${expectExit}`);
  }
  if (
    check.expectStdoutContains !== undefined &&
    !stdout.includes(check.expectStdoutContains)
  ) {
    failures.push(`stdout missing "${check.expectStdoutContains}"`);
  }
  if (check.expectStdoutMatches !== undefined) {
    const re = new RegExp(check.expectStdoutMatches);
    if (!re.test(stdout)) {
      failures.push(`stdout does not match /${check.expectStdoutMatches}/`);
    }
  }

  const passed = failures.length === 0;
  return {
    check,
    passed,
    detail: passed ? `ok ($ ${check.run})` : `${failures.join("; ")} ($ ${check.run})`,
  };
}

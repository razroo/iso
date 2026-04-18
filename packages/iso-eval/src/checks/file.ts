import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CheckResult,
  FileContainsCheck,
  FileExistsCheck,
  FileMatchesCheck,
  FileNotContainsCheck,
} from "../types.js";

export function runFileExists(
  check: FileExistsCheck,
  workspaceDir: string,
): CheckResult {
  const abs = resolve(workspaceDir, check.path);
  const passed = existsSync(abs);
  return {
    check,
    passed,
    detail: passed ? `exists: ${check.path}` : `missing: ${check.path}`,
  };
}

export function runFileContains(
  check: FileContainsCheck,
  workspaceDir: string,
): CheckResult {
  const abs = resolve(workspaceDir, check.path);
  if (!existsSync(abs)) {
    return { check, passed: false, detail: `missing: ${check.path}` };
  }
  const content = readFileSync(abs, "utf8");
  const passed = content.includes(check.value);
  return {
    check,
    passed,
    detail: passed
      ? `${check.path} contains "${check.value}"`
      : `${check.path} missing "${check.value}"`,
  };
}

export function runFileNotContains(
  check: FileNotContainsCheck,
  workspaceDir: string,
): CheckResult {
  const abs = resolve(workspaceDir, check.path);
  if (!existsSync(abs)) {
    return { check, passed: false, detail: `missing: ${check.path}` };
  }
  const content = readFileSync(abs, "utf8");
  const passed = !content.includes(check.value);
  return {
    check,
    passed,
    detail: passed
      ? `${check.path} does not contain "${check.value}"`
      : `${check.path} unexpectedly contains "${check.value}"`,
  };
}

export function runFileMatches(
  check: FileMatchesCheck,
  workspaceDir: string,
): CheckResult {
  const abs = resolve(workspaceDir, check.path);
  if (!existsSync(abs)) {
    return { check, passed: false, detail: `missing: ${check.path}` };
  }
  const content = readFileSync(abs, "utf8");
  const re = new RegExp(check.matches);
  const passed = re.test(content);
  return {
    check,
    passed,
    detail: passed
      ? `${check.path} matches /${check.matches}/`
      : `${check.path} does not match /${check.matches}/`,
  };
}

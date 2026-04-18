#!/usr/bin/env node
// Fake `claude` binary for tests.
// Reads stdin, parses argv, emits a deterministic summary so tests can assert
// the arguments + user input the runner sends.
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const val = argv[i + 1];
  return typeof val === "string" && !val.startsWith("--") ? val : "<present>";
}

const hasFlag = (name) => argv.includes(name);

const sys = flag("--system-prompt") ?? "";
const model = flag("--model") ?? "";
const tools = flag("--tools") ?? "<missing>";

let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
} catch {
  stdin = "";
}

if (process.env.FAKE_CLAUDE_FAIL === "1") {
  process.stderr.write("simulated failure\n");
  process.exit(1);
}

if (process.env.FAKE_CLAUDE_MODE === "judge") {
  // Respond based on the last non-empty line of the stdin, which should
  // include a judge question. The test plants a marker to drive the answer.
  if (stdin.includes("__FAKE_JUDGE_YES__")) process.stdout.write("yes\n");
  else process.stdout.write("no\n");
  process.exit(0);
}

const out = {
  bare: hasFlag("--bare"),
  print: hasFlag("-p"),
  noPersist: hasFlag("--no-session-persistence"),
  outputFormat: flag("--output-format"),
  tools,
  model,
  systemPrompt: sys,
  userInput: stdin,
};
process.stdout.write(JSON.stringify(out));

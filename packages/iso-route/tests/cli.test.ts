import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";

const CLI_SRC = resolve(import.meta.dirname, "..", "src", "cli.ts");

function mktmp(): string {
  return mkdtempSync(join(tmpdir(), "iso-route-cli-test-"));
}

async function runCli(args: string[], cwd = process.cwd()): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", CLI_SRC, ...args],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

function writeModels(path: string): void {
  writeFileSync(
    path,
    `default:\n` +
      `  provider: openrouter\n` +
      `  model: qwen/qwen3-coder:free\n\n` +
      `roles:\n` +
      `  reviewer:\n` +
      `    provider: anthropic\n` +
      `    model: claude-sonnet-4-6\n`,
  );
}

async function withOpenRouterFixture<T>(fn: (endpoint: string) => Promise<T>): Promise<T> {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("connection", "close");
    res.end(
      JSON.stringify({
        data: [
          {
            id: "qwen/qwen3-coder:free",
            supported_parameters: ["tools", "reasoning"],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/models`;
  try {
    return await fn(endpoint);
  } finally {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((err) => {
        if (err) rejectPromise(err);
        else resolvePromise();
      });
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
  }
}

test("CLI: verify validates model ids without emitting files", async () => {
  const dir = mktmp();
  const models = join(dir, "models.yaml");
  writeModels(models);

  await withOpenRouterFixture(async (endpoint) => {
    const result = await runCli(["verify", models, "--endpoint", endpoint]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /iso-route: verify /);
    assert.match(result.stdout, /verified:\s+1 via OpenRouter/);
    assert.match(result.stdout, /PASS/);
  });
});

test("CLI: build --verify-models runs verification before emit", async () => {
  const dir = mktmp();
  const models = join(dir, "models.yaml");
  writeModels(models);

  await withOpenRouterFixture(async (endpoint) => {
    const result = await runCli([
      "build",
      models,
      "--out",
      join(dir, "out"),
      "--dry-run",
      "--verify-models",
      "--endpoint",
      endpoint,
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /iso-route: verify /);
    assert.match(result.stdout, /PASS/);
    assert.match(result.stdout, /\[claude\] would write/);
    assert.match(result.stdout, /no files written/);
  });
});

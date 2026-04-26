import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadMigrationConfig,
  runMigrations,
} from "../src/index.js";
import { parseJson } from "../src/json.js";

function withProject(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "iso-migrate-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      private: true,
      scripts: { verify: "job-forge verify" },
      dependencies: { "job-forge": "^2.14.22" },
    }, null, 2) + "\n");
    writeFileSync(join(dir, ".gitignore"), "# Generated\n.resolved-prompt-*\nnode_modules/\n");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function config() {
  return loadMigrationConfig({
    version: 1,
    migrations: [
      {
        id: "jobforge-index",
        operations: [
          {
            type: "json-merge",
            path: "package.json",
            pointer: "/scripts",
            value: {
              "index:status": "job-forge index:status",
              "index:verify": "job-forge index:verify",
            },
          },
          {
            type: "json-set",
            path: "package.json",
            pointer: "/dependencies/job-forge",
            value: "^2.14.25",
          },
          {
            type: "ensure-lines",
            path: ".gitignore",
            after: ".resolved-prompt-*",
            lines: [".jobforge-ledger/", ".jobforge-index.json"],
          },
        ],
      },
    ],
  });
}

test("plans and applies idempotent JSON and text migrations", () => {
  withProject((dir) => {
    const plan = runMigrations(config(), { root: dir, dryRun: true });
    assert.equal(plan.changed, true);
    assert.equal(plan.changeCount, 3);
    assert.equal(readFileSync(join(dir, "package.json"), "utf8").includes("index:status"), false);

    const applied = runMigrations(config(), { root: dir, dryRun: false });
    assert.equal(applied.changed, true);

    const pkg = parseJson(readFileSync(join(dir, "package.json"), "utf8"));
    assert.equal(typeof pkg, "object");
    assert.equal((pkg as { scripts: Record<string, string> }).scripts["index:verify"], "job-forge index:verify");
    assert.equal((pkg as { dependencies: Record<string, string> }).dependencies["job-forge"], "^2.14.25");

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.match(gitignore, /\.jobforge-ledger\/\n\.jobforge-index\.json/);

    const check = runMigrations(config(), { root: dir, dryRun: true });
    assert.equal(check.changed, false);
    assert.equal(check.changeCount, 0);
  });
});

test("supports replacement and guarded file writes", () => {
  withProject((dir) => {
    const migration = loadMigrationConfig({
      version: 1,
      migrations: [
        {
          id: "text",
          operations: [
            {
              type: "replace",
              path: ".gitignore",
              search: "node_modules/",
              replace: "node_modules/\n.cache/",
            },
            {
              type: "write-file",
              path: "templates/context.json",
              content: "{\n  \"version\": 1\n}\n",
              overwrite: false,
            },
          ],
        },
      ],
    });

    const result = runMigrations(migration, { root: dir, dryRun: false });
    assert.equal(result.changeCount, 2);
    assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /\.cache\//);
    assert.equal(readFileSync(join(dir, "templates", "context.json"), "utf8"), "{\n  \"version\": 1\n}\n");
  });
});

test("rejects paths outside the root", () => {
  withProject((dir) => {
    const migration = loadMigrationConfig({
      version: 1,
      migrations: [
        {
          id: "escape",
          operations: [{ type: "write-file", path: "../escape.txt", content: "no\n" }],
        },
      ],
    });
    assert.throws(() => runMigrations(migration, { root: dir, dryRun: false }), /escapes root/);
  });
});

test("rejects non-boolean operation flags", () => {
  assert.throws(
    () => loadMigrationConfig({
      version: 1,
      migrations: [
        {
          id: "invalid-flag",
          operations: [
            {
              type: "write-file",
              path: "example.txt",
              content: "example\n",
              overwrite: "false",
            },
          ],
        },
      ],
    }),
    /overwrite must be a boolean/,
  );
});

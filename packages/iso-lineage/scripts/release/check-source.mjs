import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/release/check-source.mjs <version>");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.version !== version) {
  console.error(`package.json version ${pkg.version ?? "unknown"} does not match release tag ${version}`);
  process.exit(1);
}
console.log(`${pkg.name}: ${pkg.version}`);

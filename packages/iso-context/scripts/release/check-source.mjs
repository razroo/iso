import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/release/check-source.mjs <version>');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

if (pkg.version !== version) {
  console.error(
    `package.json version ${pkg.version ?? 'unknown'} does not match release tag ${version}. ` +
      `Bump "version" in package.json, commit, and retag before publishing.`,
  );
  process.exit(1);
}

for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = pkg[section];
  if (!deps) continue;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.startsWith('file:')) {
      console.error(
        `${section}["${name}"] is "${spec}" - file: deps are published verbatim and break consumers.`,
      );
      process.exit(1);
    }
  }
}

console.log(`${pkg.name}: ${pkg.version}`);

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expected = process.argv[2];
if (!expected) {
  console.error('usage: check-source.mjs <expected-version>');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
if (pkg.version !== expected) {
  console.error(`package.json version ${pkg.version} does not match release tag ${expected}`);
  process.exit(1);
}

console.log(`${pkg.name}: ${pkg.version}`);

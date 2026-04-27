import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMcp, validateConfig, validateSource } from '../src/validate.mjs';

test('validateMcp: rejects missing "servers" object', () => {
  const d = validateMcp({});
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, 'error');
  assert.match(d[0].message, /"servers" object/);
});

test('validateMcp: accepts a valid server', () => {
  const d = validateMcp({ servers: { ok: { command: 'echo', args: ['hi'], env: { K: 'v' } } } });
  assert.equal(d.length, 0);
});

test('validateMcp: flags missing command, non-string args, non-string env values', () => {
  const d = validateMcp({
    servers: {
      a: { args: ['x'] },
      b: { command: 'y', args: 'not-an-array' },
      c: { command: 'z', env: { X: 123 } },
    },
  });
  const codes = d.map((x) => x.message);
  assert.ok(codes.some((m) => /a" is missing.*command/.test(m)));
  assert.ok(codes.some((m) => /b".*non-string-array/.test(m)));
  assert.ok(codes.some((m) => /c".*env var "X".*string/.test(m)));
});

test('validateConfig: warns on unknown target keys', () => {
  const d = validateConfig({ targets: { opencode: {}, pi: {}, nonsense: {} } });
  assert.ok(d.some((x) => x.severity === 'warning' && /Unknown target "nonsense"/.test(x.message)));
});

test('validateSource: catches duplicate agent names across files', () => {
  const src = {
    mcp: { servers: {} },
    config: {},
    agents: [
      { slug: 'a', name: 'dup', description: 'ok', body: 'body', targets: {} },
      { slug: 'b', name: 'dup', description: 'ok', body: 'body', targets: {} },
    ],
    commands: [],
  };
  const d = validateSource(src);
  const dup = d.filter((x) => /Duplicate agent name/.test(x.message));
  assert.equal(dup.length, 1);
  assert.match(dup[0].file, /agents\/b\.md/);
  assert.match(dup[0].message, /first seen in iso\/agents\/a\.md/);
});

test('validateSource: warns on empty description and empty body', () => {
  const src = {
    mcp: { servers: {} },
    config: {},
    agents: [{ slug: 'a', name: 'a', description: '', body: '', targets: {} }],
    commands: [],
  };
  const d = validateSource(src);
  assert.ok(d.some((x) => x.severity === 'warning' && /description/.test(x.field ?? '')));
  assert.ok(d.some((x) => x.severity === 'warning' && /empty body/.test(x.message)));
});

test('validateSource: flags unknown target override keys on an agent', () => {
  const src = {
    mcp: { servers: {} },
    config: {},
    agents: [
      {
        slug: 'a',
        name: 'a',
        description: 'a',
        body: 'b',
        targets: { claude: 'skip', pi: { description: 'pi skill' }, madeup: { model: 'x' } },
      },
    ],
    commands: [],
  };
  const d = validateSource(src);
  assert.ok(
    d.some((x) => x.severity === 'warning' && /Unknown target "madeup"/.test(x.message)),
  );
});

test('validateSource: requires model to be a string, not a number', () => {
  const src = {
    mcp: { servers: {} },
    config: {},
    agents: [{ slug: 'a', name: 'a', description: 'd', body: 'b', targets: {}, model: 42 }],
    commands: [],
  };
  const d = validateSource(src);
  assert.ok(d.some((x) => x.severity === 'error' && /"model" must be a string/.test(x.message)));
});

test('validateSource: passes on a minimal clean source', () => {
  const src = {
    mcp: { servers: { a: { command: 'echo' } } },
    config: {},
    agents: [{ slug: 'x', name: 'x', description: 'ok', body: 'hello', targets: {} }],
    commands: [{ slug: 'y', name: 'y', description: 'ok', body: 'hello', targets: {} }],
  };
  const d = validateSource(src);
  assert.equal(d.length, 0, JSON.stringify(d, null, 2));
});

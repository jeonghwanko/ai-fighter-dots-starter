import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('every api module opts into type checking', async () => {
  const unchecked = [];
  for (const name of (await readdir(new URL('../api/', import.meta.url))).filter(name => name.endsWith('.mjs')))
    if (!/^\/\/ @ts-check\r?\n/.test(await readFile(new URL(`../api/${name}`, import.meta.url), 'utf8'))) unchecked.push(name);
  assert.deepEqual(unchecked, []);
});

test('tsc finds no type errors in api/ (npm run typecheck)', () => {
  const run = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

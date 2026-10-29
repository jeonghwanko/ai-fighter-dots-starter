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

test('Deno checks api/ at the same strictness as tsc', async () => {
  // Deno honours // @ts-check too: `deno check supabase/functions/ai-fighter/index.ts` reads these files with the Edge deno.json.
  const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).compilerOptions;
  assert.equal((await read('tsconfig.json')).strict, false);
  assert.equal((await read('supabase/functions/ai-fighter/deno.json')).strict, false);
});

test('tsc finds no type errors in api/ (npm run typecheck)', () => {
  const run = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

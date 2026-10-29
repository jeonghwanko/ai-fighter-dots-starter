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

test('Deno checks api/ at the same strictness as tsc, in every Edge function', async () => {
  // Deno honours // @ts-check too: `deno check supabase/functions/<name>/index.ts` reads these files with that function's
  // deno.json. Only ai-fighter's was aligned at first; ai-fighter-mcp checked them under Deno's default until 2026-10-29.
  const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).compilerOptions;
  assert.equal((await read('tsconfig.json')).strict, true);
  const functions = (await readdir(new URL('../supabase/functions/', import.meta.url), { withFileTypes: true })).filter(entry => entry.isDirectory());
  for (const { name } of functions) {
    const file = `supabase/functions/${name}/deno.json`;
    if (await readFile(new URL(`../${file}`, import.meta.url)).then(() => true, () => false)) assert.deepEqual(await read(file), { strict: true }, file);
  }
});

test('tsc finds no type errors in api/ under strict (npm run typecheck)', () => {
  const run = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

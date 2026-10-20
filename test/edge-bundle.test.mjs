import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { edgeFiles } from '../scripts/edge-bundle.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
let temporary;
before(async () => { temporary = await mkdtemp(path.join(tmpdir(), 'fighter-edge-')); });
after(async () => { await rm(temporary, { recursive: true, force: true }); });

test('the Edge bundle holds every module the entry imports and nothing Node-only', async () => {
  const files = await edgeFiles();
  for (const required of ['api/handler.mjs', 'api/http.mjs', 'api/duels.mjs', 'api/fighter-statistics.mjs',
    'contracts/ai-fighter/validate.mjs', 'contracts/ai-fighter/v1/spec.json', 'contracts/ai-fighter/v1/fighter.schema.json',
    'supabase/functions/ai-fighter/duel-engine.mjs']) assert.ok(files.includes(required), required);
  assert.ok(files.every(file => !/^(server|mcp|scripts|worker)\//.test(file)), JSON.stringify(files));
  for (const file of files) await access(path.join(repository, file));
});
test('an import the Edge runtime cannot resolve fails before deploy', async () => {
  await mkdir(path.join(temporary, 'fn'));
  await writeFile(path.join(temporary, 'fn', 'deno.json'), JSON.stringify({ imports: { ajv: 'npm:ajv@6.15.0' } }));
  await writeFile(path.join(temporary, 'fn', 'index.ts'), "import { decode } from './decode.mjs';\n");
  await writeFile(path.join(temporary, 'fn', 'decode.mjs'), "import sharp from 'sharp';\nexport const decode = sharp;\n");
  await assert.rejects(edgeFiles({ root: temporary, entry: 'fn/index.ts', importMap: 'fn/deno.json', lock: 'fn/deno.lock' }), /sharp/);
});

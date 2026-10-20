import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '../api/handler.mjs';
import { runOnce } from '../worker/run.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const manifestText = await readFile(new URL('../examples/sparring-bot/fighter.json', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestText);
const assetBytes = new Map(await Promise.all(manifest.assets.map(async a => [a.id, await readFile(new URL(`../examples/sparring-bot/${a.path}`, import.meta.url))])));
let directory, config, realFetch;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'fighter-worker-'));
  config = path.join(directory, 'worker.json');
  await writeFile(config, JSON.stringify({ url, workerToken: `afw_${'a'.repeat(64)}` }));
  realFetch = globalThis.fetch;
});
after(async () => { globalThis.fetch = realFetch; await rm(directory, { recursive: true, force: true }); });

/** A claimed job served by a stub API. `download(id)` returns the asset response or throws. */
async function serve(download, text = manifestText) {
  const calls = { finish: null, inFlight: 0, maxInFlight: 0 };
  const manifestSha256 = await sha256(new TextEncoder().encode(text));
  globalThis.fetch = async (target, init) => {
    const route = String(target);
    if (route.endsWith('/worker/claim')) return Response.json({ ok: true, stage: 'validating', submissionId: crypto.randomUUID(), leaseToken: crypto.randomUUID(),
      manifestText: text, manifestSha256, files: manifest.assets.map(a => ({ ...a, downloadUrl: `${url}/storage/v1/object/sign/ai-fighter-beta/${a.id}.webp?token=t` })) });
    if (route.endsWith('/worker/finish')) { calls.finish = JSON.parse(init.body); return Response.json({ ok: true, stage: calls.finish.passed ? 'registered' : 'rejected' }); }
    const id = new URL(route).pathname.split('/').at(-1).replace('.webp', '');
    calls.inFlight++; calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
    try { await new Promise(resolve => setTimeout(resolve, 5)); return await download(id); }
    finally { calls.inFlight--; }
  };
  return calls;
}
const ok = id => new Response(assetBytes.get(id));

test('a valid package registers, with at most four downloads at once', async () => {
  const calls = await serve(ok);
  assert.equal((await runOnce(config)).stage, 'registered');
  assert.equal(calls.finish.passed, true);
  assert.equal(calls.finish.result.stage, 'bytes-hashes-and-full-decode');
  assert.ok(calls.maxInFlight > 1 && calls.maxInFlight <= 4, String(calls.maxInFlight));
});
test('infrastructure failures leave the job for a retry instead of rejecting the creator', async () => {
  for (const [download, expected] of [
    [id => { if (id === 'walk') throw new TypeError('fetch failed'); return ok(id); }, 'download-failed'],
    [id => id === 'walk' ? new Response('server error', { status: 500 }) : ok(id), 'download-failed'],
    [id => id === 'walk' ? new Response(Buffer.alloc(assetBytes.get('walk').length)) : ok(id), 'download-integrity'],
  ]) {
    const calls = await serve(download);
    const result = await runOnce(config);
    assert.deepEqual([result.stage, result.code], ['retry-later', expected]);
    assert.equal(calls.finish, null);
  }
});
test('a manifest that fails the contract is a verdict and is finished as rejected', async () => {
  const broken = JSON.stringify({ ...manifest, localId: 'Not Valid' });
  const calls = await serve(ok, broken);
  assert.equal((await runOnce(config)).stage, 'rejected');
  assert.deepEqual([calls.finish.passed, calls.finish.result.stage, calls.finish.result.errors[0].code], [false, 'server-manifest', 'invalid-server-manifest']);
});
test('the first failed download stops the others before the job folder is removed', async () => {
  let started = 0;
  await serve(async id => {
    started++;
    if (id === 'idle') throw new TypeError('fetch failed');
    await new Promise(resolve => setTimeout(resolve, 50));
    return ok(id);
  });
  const result = await runOnce(config);
  assert.equal(result.stage, 'retry-later');
  assert.ok(started < manifest.assets.length, `${started} of ${manifest.assets.length} downloads started`);
});

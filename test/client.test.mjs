import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRemoteClient } from '../api/client.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const jwt = secondsFromNow => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString('base64url')}.signature`;
let directory, realFetch, sentTokens;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'fighter-client-'));
  realFetch = globalThis.fetch;
  globalThis.fetch = async (_, init) => { sentTokens.push(init.headers.authorization.slice('Bearer '.length));
    return new Response(JSON.stringify({ ok: true, stage: 'public-contract' }), { headers: { 'content-type': 'application/json' } }); };
});
after(async () => { globalThis.fetch = realFetch; await rm(directory, { recursive: true, force: true }); });

async function clientWith(accessToken, refresh) {
  const file = path.join(directory, `${crypto.randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ url, publishableKey: 'sb_publishable_test', accessToken, refreshToken: 'r1' }), { mode: 0o600 });
  const refreshes = [];
  const client = await createRemoteClient(file, { createAuthClient: () => ({ auth: { refreshSession: async ({ refresh_token }) => {
    refreshes.push(refresh_token); await new Promise(resolve => setTimeout(resolve, 10)); return refresh(); } } }) });
  sentTokens = [];
  return { file, client, refreshes };
}

test('a valid access token is reused without an auth round trip', async () => {
  const token = jwt(3600), { client, refreshes } = await clientWith(token, () => assert.fail('no refresh expected'));
  await client.request('spec'); await client.request('spec');
  assert.deepEqual(refreshes, []); assert.deepEqual(sentTokens, [token, token]);
});
test('a token near expiry is refreshed once for concurrent calls and the session file is replaced atomically', async () => {
  const fresh = jwt(3600);
  const { file, client, refreshes } = await clientWith(jwt(10), () => ({ data: { session: { access_token: fresh, refresh_token: 'r2' } } }));
  await Promise.all([client.request('spec'), client.request('spec'), client.request('spec')]);
  assert.deepEqual(refreshes, ['r1']); assert.deepEqual(sentTokens, [fresh, fresh, fresh]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([saved.accessToken, saved.refreshToken, saved.url], [fresh, 'r2', url]);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), []);
});
test('a revoked session asks for a new sign-in and keeps the saved file', async () => {
  const { file, client } = await clientWith(jwt(-5), () => ({ data: { session: null }, error: new Error('revoked') }));
  const before = await readFile(file, 'utf8');
  await assert.rejects(client.request('spec'), /client-sign-in-required/);
  assert.equal(await readFile(file, 'utf8'), before); assert.deepEqual(sentTokens, []);
});

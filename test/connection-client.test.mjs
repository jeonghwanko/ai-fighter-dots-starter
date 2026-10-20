import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server.mjs';
import { createRemoteClient } from '../api/client.mjs';
import { startConnection, connectionCommand } from '../auth/agent-connection.mjs';
import { createOwnerConnectionClient } from '../auth/owner-client.mjs';
import { createConnectionUI } from '../scripts/connection-ui.mjs';
import { connectionDatabase, project, resource } from './support/connection-db.mjs';

let f, directory, originalFetch;
before(async () => {
  f = await connectionDatabase(); directory = await mkdtemp(path.join(tmpdir(), 'af-connection-'));
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => f.handle(new Request(url, init));
});
after(async () => { globalThis.fetch = originalFetch; await f?.sql.close(); await rm(directory, { recursive: true, force: true }); });
const configFile = () => path.join(directory, `${crypto.randomUUID()}.json`);
const approve = code => f.send('connections/approve', { body: { code, permissions: ['fighter:read', 'fighter:submit'], seconds: 900, expectedSubject: f.owner } });

test('CLI starts and retries safely, protects the token file, and remote client never creates an owner session', async () => {
  const file = configFile(), p = await startConnection(file, { url: project });
  const again = await startConnection(file, { url: project });
  assert.equal(p.connection.id, again.connection.id); assert.equal(p.code, again.code);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.accessToken, undefined); assert.equal(saved.refreshToken, undefined);
  assert.equal(saved.agentToken.length, 68); assert.ok(!JSON.stringify(p).includes(saved.agentToken));
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  const remote = await createRemoteClient(file, { createAuthClient: () => assert.fail('agent must not create owner auth client') });
  assert.equal(remote.session, undefined);
  await assert.rejects(remote.request(`fighters/${crypto.randomUUID()}`), /connection-inactive/);
  assert.equal((await connectionCommand(file, 'status')).connection.status, 'pending');
  await connectionCommand(file, 'cancel');
  assert.equal((await connectionCommand(file, 'status')).connection.status, 'cancelled');
  await assert.rejects(startConnection(file, { url: project, permissions: ['fighter:submit'] }), /connection-config-conflict/);
});
test('lost start response retries the same request; existing owner config is never overwritten', async () => {
  const file = configFile(); let first = true;
  globalThis.fetch = async (url, init) => {
    const response = await f.handle(new Request(url, init));
    if (first) { first = false; throw new Error('lost-response'); }
    return response;
  };
  await assert.rejects(startConnection(file, { url: project }), /api-unreachable/);
  const before = await readFile(file, 'utf8');
  assert.equal((await startConnection(file, { url: project })).connection.status, 'pending');
  assert.equal(await readFile(file, 'utf8'), before);
  globalThis.fetch = async (url, init) => f.handle(new Request(url, init));
  const legacy = configFile(), text = JSON.stringify({ url: project, accessToken: 'owner-fixture', refreshToken: 'refresh-fixture' });
  await writeFile(legacy, text, { mode: 0o600 });
  await assert.rejects(startConnection(legacy, { url: project }), /connection-config-conflict/);
  assert.equal(await readFile(legacy, 'utf8'), text);
});
test('official MCP SDK submits through the new grant, retries unchanged and is blocked after disconnect', async () => {
  const file = configFile(), p = await startConnection(file, { url: project, permissions: ['fighter:read', 'fighter:submit'] });
  assert.equal((await approve(p.code)).status, 200);
  const remote = await createRemoteClient(file), root = fileURLToPath(new URL('../', import.meta.url));
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root, remote }); await server.connect(serverSide);
  const client = new Client({ name: 'agent-grant-fixture', version: '1.0.0' });
  await client.connect(clientSide);
  try {
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(t => t.name === 'submit_fighter_package'));
    assert.ok(!tools.some(t => t.name === 'open_creator_homepage'));
    assert.equal((await client.callTool({ name: 'get_my_fighter', arguments: {} })).structuredContent.fighter, null);
    const args = { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID() };
    const result = await client.callTool({ name: 'submit_fighter_package', arguments: args });
    assert.equal(result.structuredContent.stage, 'queued', JSON.stringify(result.structuredContent));
    assert.equal(f.objects.size, 11);
    const duplicate = await client.callTool({ name: 'submit_fighter_package', arguments: args });
    assert.equal(duplicate.structuredContent.submissionId, result.structuredContent.submissionId);
    assert.equal(f.objects.size, 11);
    await f.send('connections/revoke', { body: { connectionId: p.connection.id } });
    const blocked = await client.callTool({ name: 'get_fighter_submission', arguments: { submissionId: result.structuredContent.submissionId } });
    assert.equal(blocked.structuredContent.code, 'connection-inactive');
    assert.equal((await f.sql.query('select count(*)::int n from af_submissions')).rows[0].n, 1);
  } finally { await client.close(); await server.close(); }
});
test('real pinned Supabase SDK creates a Google PKCE URL without launching or automating a browser', async () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const supabase = createClient(project, 'sb_publishable_fixture', { auth: {
    flowType: 'pkce', persistSession: true, storage, autoRefreshToken: false, detectSessionInUrl: false,
  }, global: { fetch: async () => assert.fail('login URL generation needs no remote request') } });
  const owner = createOwnerConnectionClient({ supabase, url: project });
  const login = new URL(await owner.login('http://127.0.0.1:8791/'));
  assert.equal(login.origin, project); assert.equal(login.searchParams.get('provider'), 'google');
  assert.equal(login.searchParams.get('redirect_to'), 'http://127.0.0.1:8791/');
  assert.match(login.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(login.searchParams.get('code_challenge_method').toLowerCase(), 's256');
  assert.ok([...store.keys()].some(k => k.endsWith('-code-verifier')));
  supabase.auth.stopAutoRefresh();
});
test('owner adapter authenticates decisions with its session, exchanges callback and propagates denial/expiry errors', async () => {
  let session = null; const exchanges = [];
  const supabase = { auth: {
    getSession: async () => ({ data: { session } }),
    exchangeCodeForSession: async code => { exchanges.push(code); return code === 'valid-fixture-code'
      ? { data: { session: { access_token: 'fixture-owner-token' } } } : { data: { session: null }, error: new Error('invalid-code') }; },
  } };
  const owner = createOwnerConnectionClient({ supabase, url: project });
  await assert.rejects(owner.list(), /sign-in-required/);
  await assert.rejects(owner.callback('invalid'), /login-callback-failed/);
  assert.equal(await owner.callback('valid-fixture-code'), true);
  assert.deepEqual(exchanges, ['invalid', 'valid-fixture-code']);
  session = { access_token: 'fixture-owner-token' };
  const p = await startConnection(configFile(), { url: project });
  assert.equal((await owner.inspect(p.code)).status, 'pending');
  assert.equal((await owner.deny(p.code)).status, 'denied');
  await assert.rejects(owner.approve(p.code, ['fighter:read']), /inspect-required/);
  assert.ok((await owner.list()).items.every(item => !('token_hash' in item) && !('code_hash' in item)));
});
test('connection UI serves local SDK and public config with CSP; rejects foreign Host, Origin and secret keys', async () => {
  assert.throws(() => createConnectionUI({ url: project, publishableKey: 'sb_secret_forbidden' }), /public-config-required/);
  const server = createConnectionUI({ url: project, publishableKey: 'sb_publishable_fixture', port: 8792 });
  server.listen(8792, '127.0.0.1'); await once(server, 'listening');
  try {
    const get = (route, headers) => originalFetch(`http://127.0.0.1:8792${route}`, { headers });
    const page = await get('/'); assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await get('/supabase.js')).status, 200);
    assert.deepEqual(await (await get('/config.json')).json(), { url: project, publishableKey: 'sb_publishable_fixture' });
    assert.equal((await get('/config.json', { origin: 'https://evil.example' })).status, 403);
    // fetch replaces Host; use a real HTTP request to exercise the hostile Host boundary.
    const hostile = await new Promise((resolve, reject) => {
      const req = httpRequest('http://127.0.0.1:8792/', { headers: { host: 'evil.example' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(hostile, 403);
    assert.equal((await get('/api/client.mjs')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

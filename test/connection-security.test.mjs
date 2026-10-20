import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { verifiedUserId } from '../api/http.mjs';
import { createRemoteClient } from '../api/client.mjs';
import { readPrivateConfig } from '../api/private-config.mjs';
import { startConnection } from '../auth/agent-connection.mjs';
import { createOwnerConnectionClient } from '../auth/owner-client.mjs';
import { connectionDatabase, project, resource } from './support/connection-db.mjs';
import { claimsFor } from './support/auth.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function start(f) {
  const token = `afg_${randomBytes(32).toString('hex')}`, code = randomBytes(16).toString('hex');
  const body = { requestId: crypto.randomUUID(), clientId: 'ai-fighter-stdio', tokenHash: hash(token),
    codeHash: hash(code), permissions: ['fighter:read'] };
  const r = await f.send('connections/start', { token: null, body });
  assert.equal(r.status, 200);
  return { token, code, body, id: r.data.connection.id,
    headers: { 'x-af-client-id': body.clientId, 'x-af-resource': resource } };
}
test('existing broad Storage policies cannot bypass API-only fighter bucket via owner or OAuth JWT', async () => {
  let key;
  const f = await connectionDatabase({ beforeConnectionSQL: async ({ sql, owner }) => {
    key = `${owner}/fixture/idle.webp`;
    await sql.exec(`grant usage on schema storage to anon,authenticated;
      grant select,insert,update,delete on storage.objects to anon,authenticated;
      create policy existing_owner_storage on storage.objects for all to authenticated
        using(split_part(name,'/',1)=auth.uid()::text) with check(split_part(name,'/',1)=auth.uid()::text);
      create policy existing_guest_read on storage.objects for select to anon using(true);`);
    await sql.query("insert into storage.objects values('ai-fighter-beta',$1,'{}'),('game-avatar',$1,'{}')", [key]);
    await sql.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';
      set request.jwt.claims='{"client_id":"native-oauth"}'`);
    // Regression demonstrates the unsafe shared-project condition before the new policy.
    assert.equal((await sql.query("select * from storage.objects where bucket_id='ai-fighter-beta'")).rows.length, 1);
    assert.equal((await sql.query("update storage.objects set metadata='{}' where bucket_id='ai-fighter-beta' returning name")).rows.length, 1);
    await sql.exec('reset role');
  } });
  try {
    await f.sql.exec('reset role');
    for (const claims of ['{}', '{"client_id":"native-oauth"}']) {
      await f.sql.exec(`set role authenticated; set request.jwt.claims='${claims}'`);
      assert.equal((await f.sql.query("select * from storage.objects where bucket_id='ai-fighter-beta'")).rows.length, 0);
      assert.equal((await f.sql.query("update storage.objects set metadata='{}' where bucket_id='ai-fighter-beta' returning name")).rows.length, 0);
      assert.equal((await f.sql.query("delete from storage.objects where bucket_id='ai-fighter-beta' returning name")).rows.length, 0);
      await assert.rejects(f.sql.query("insert into storage.objects values('ai-fighter-beta',$1,'{}')", [`${f.owner}/new.webp`]), /row-level security/);
      assert.equal((await f.sql.query("select * from storage.objects where bucket_id='game-avatar'")).rows.length, 1);
      await f.sql.exec('reset role');
    }
    await f.sql.exec('set role anon');
    assert.equal((await f.sql.query("select * from storage.objects where bucket_id='ai-fighter-beta'")).rows.length, 0);
    assert.equal((await f.sql.query("select * from storage.objects where bucket_id='game-avatar'")).rows.length, 1);
    await f.sql.exec('reset role; set role service_role');
    assert.equal((await f.sql.query("select * from storage.objects where bucket_id='ai-fighter-beta'")).rows.length, 1);
  } finally { await f.sql.close(); }
});
test('consent is bound to the inspected account; cookie-only CSRF and service-role JWTs cannot approve', async () => {
  const f = await connectionDatabase();
  try {
    const p = await start(f);
    const inspection = await f.send('connections/inspect', { body: { code: p.code } });
    assert.equal(inspection.data.connection.subject, f.owner);
    const body = { code: p.code, permissions: ['fighter:read'], seconds: 900, expectedSubject: f.owner };
    assert.equal((await f.send('connections/approve', { token: null, headers: { cookie: 'session=fixture-owner-token', origin: 'https://evil.example' }, body })).status, 401);
    assert.equal((await f.send('connections/approve', { token: 'fixture-other-token', body })).data.code, 'connection-account-changed');
    assert.equal((await f.send('connections/approve', { body: { code: p.code, permissions: ['fighter:read'], seconds: 900 } })).status, 400);
    f.claims.set('fixture-service-token', claimsFor(f.owner, { iss: `${project}/auth/v1`, role: 'service_role' }));
    assert.equal((await f.send('connections/approve', { token: 'fixture-service-token', body })).status, 401);
    const pending = await f.send('connections/status', { token: p.token, headers: p.headers });
    assert.equal(pending.data.connection.status, 'pending');
    assert.equal((await f.send('connections/approve', { body })).status, 200);
    assert.equal((await f.sql.query('select owner_id from af_connections where id=$1', [p.id])).rows[0].owner_id, f.owner);
  } finally { await f.sql.close(); }
});
test('approve/revoke interleaving and reused start cannot resurrect or extend a grant', async () => {
  const f = await connectionDatabase();
  try {
    const p = await start(f), body = { code: p.code, permissions: ['fighter:read'], seconds: 900, expectedSubject: f.owner };
    const first = await f.send('connections/approve', { body });
    const repeat = await f.send('connections/approve', { body: { ...body, seconds: 3600 } });
    assert.equal(repeat.data.connection.expiresAt, first.data.connection.expiresAt);
    const results = await Promise.all([
      f.send('connections/approve', { body }), f.send('connections/revoke', { body: { connectionId: p.id } }),
      f.send('connections/approve', { body }),
    ]);
    assert.ok(results.every(r => [200, 403].includes(r.status)));
    assert.equal((await f.send('connections/status', { token: p.token, headers: p.headers })).data.connection.status, 'revoked');
    assert.equal((await f.send('connections/start', { token: null, body: p.body })).data.connection.status, 'revoked');
    assert.equal((await f.send('connections/start', { token: null, body: { ...p.body, requestId: crypto.randomUUID() } })).status, 409);
    assert.equal((await f.send('fighters', { token: p.token, headers: p.headers, method: 'GET' })).status, 403);
  } finally { await f.sql.close(); }
});
test('malformed credentials never appear in MCP stderr or JSON parse errors', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'af-config-security-'));
  try {
    const file = path.join(directory, 'invalid.json'), canary = 'PRIVATE_FIXTURE_CANARY_DO_NOT_PRINT';
    await writeFile(file, `{"agentToken":"${canary}",BROKEN`, { mode: 0o600 });
    await assert.rejects(createRemoteClient(file), error => error.message === 'invalid-client-config' && !error.stack.includes(canary));
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url))], {
      env: { ...process.env, AI_FIGHTER_CLIENT_CONFIG: file, AI_FIGHTER_ROOT: '' },
    }).then(() => assert.fail('invalid config must stop MCP'), error => error);
    assert.match(result.stderr, /invalid-client-config/);
    assert.ok(!result.stderr.includes(canary)); assert.ok(!result.stdout.includes(canary));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('credential files reject public permissions, symlinks and hardlinks without changing targets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'af-config-permissions-'));
  try {
    const file = path.join(directory, 'private.json'), symbolic = path.join(directory, 'symbolic.json'), hard = path.join(directory, 'hard.json');
    await writeFile(file, '{}', { mode: 0o600 });
    assert.deepEqual(await readPrivateConfig(file), {});
    if (process.platform !== 'win32') {
      await chmod(file, 0o644);
      await assert.rejects(readPrivateConfig(file), /unsafe-client-config/);
      await symlink(file, symbolic);
      await assert.rejects(startConnection(symbolic, { url: project }), /unsafe-client-config/);
      assert.equal((await stat(file)).mode & 0o777, 0o644);
      await chmod(file, 0o600);
      await assert.rejects(readPrivateConfig(symbolic), /unsafe-client-config/);
    }
    await link(file, hard);
    await assert.rejects(readPrivateConfig(file), /unsafe-client-config/);
    await assert.rejects(readPrivateConfig(hard), /unsafe-client-config/);
    assert.equal(await readFile(file, 'utf8'), '{}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('owner adapter discards stale inspections and sends server-confirmed expected subject', async () => {
  const subject = crypto.randomUUID(), calls = [], releases = [];
  const owner = createOwnerConnectionClient({
    url: project, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-owner-token' } } }) } },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith('/inspect')) return new Promise(resolve => releases.push(() => resolve(new Response(JSON.stringify({ connection: { status: 'pending', subject } })))));
      return new Response(JSON.stringify({ connection: { status: 'approved' } }));
    },
  });
  const codeA = 'a'.repeat(32), codeB = 'b'.repeat(32);
  const first = owner.inspect(codeA); await new Promise(resolve => setImmediate(resolve));
  const second = owner.inspect(codeB); await new Promise(resolve => setImmediate(resolve));
  releases[1](); await second; releases[0](); await assert.rejects(first, /connection-inspection-stale/);
  await assert.rejects(owner.approve(codeA, ['fighter:read']), /inspect-required/);
  await owner.approve(codeB, ['fighter:read']);
  assert.equal(calls.at(-1).body.expectedSubject, subject);
  assert.equal(calls.at(-1).body.code, codeB);
  const pending = owner.inspect(codeA); await new Promise(resolve => setImmediate(resolve)); owner.clearConsent();
  releases[2](); await assert.rejects(pending, /connection-inspection-stale/);
  await assert.rejects(owner.approve(codeA, ['fighter:read']), /inspect-required/);
});
test('consent UI invalidates changed code/account, ignores stale results and strips callback before fetch', async () => {
  // Execute the page module with a small DOM stub, without browser automation or a login.
  const source = (await readFile(new URL('../connect/app.mjs', import.meta.url), 'utf8')).replace(/^import .*\n/, '');
  const elements = new Map(), storage = new Map(), approvals = [], logins = [], callbacks = [];
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, disabled: false, hidden: true,
      textContent: '', replaceChildren() {}, append() {} });
    return elements.get(id);
  };
  let authChanged, release, cleanURL = false, defer = false;
  const pending = { status: 'pending', requested: ['fighter:read'], agentId: 'fixture', resource, clientName: 'fixture' };
  const codeA = 'a'.repeat(32), codeB = 'b'.repeat(32);
  const owner = { clearConsent() {}, callback: async code => callbacks.push(code),
    login: async redirect => { logins.push(redirect); return 'https://provider.example/fixture'; },
    inspect: async () => defer ? new Promise(resolve => { release = () => resolve(pending); }) : pending,
    approve: async code => approvals.push(code), list: async () => ({ items: [] }) };
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key), clear: () => storage.clear() };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('globalThis', 'document', 'fetch', 'sessionStorage', 'history', 'location', 'createOwnerConnectionClient', source)(
    { supabase: { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'account-a' } } }),
      onAuthStateChange: fn => { authChanged = fn; } } }) } },
    { getElementById: get, createElement: () => ({}) },
    async () => { assert.equal(cleanURL, true); return { json: async () => ({ url: project, publishableKey: 'sb_publishable_fixture' }) }; },
    sessionStorage, { replaceState: (_state, _title, url) => { assert.equal(url, '/'); cleanURL = true; } },
    { href: 'http://127.0.0.1:8791/?code=unexpected-fixture&returnTo=https://evil.example', origin: 'http://127.0.0.1:8791', assign() {} },
    () => owner);
  assert.deepEqual(callbacks, []);
  assert.equal(get('message').textContent, 'unexpected-login-callback');
  authChanged('INITIAL_SESSION', { user: { id: 'account-a' } });
  get('code').value = codeA; await get('inspect').onclick();
  assert.equal(get('consent').hidden, false);
  get('code').value = codeB; get('read').checked = true; get('seconds').value = '900';
  await get('approve').onclick();
  assert.deepEqual(approvals, []); assert.equal(get('consent').hidden, true);
  await get('inspect').onclick(); authChanged('SIGNED_IN', { user: { id: 'account-b' } });
  await get('approve').onclick();
  assert.deepEqual(approvals, []); assert.equal(get('consent').hidden, true);
  defer = true; const inspection = get('inspect').onclick();
  await new Promise(resolve => setImmediate(resolve));
  get('code').value = codeA; get('code').oninput(); release(); await inspection;
  assert.equal(get('consent').hidden, true);
  await get('login').onclick();
  assert.deepEqual(logins, ['http://127.0.0.1:8791/']);
});
test('pinned SDK verifies a signed JWT via mock JWKS without contaminating service-role DB authorization', async () => {
  // Ephemeral in-memory test key only; no project keys or credentials are created.
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'local-review', alg: 'ES256', use: 'sig' };
  const sign = async claims => {
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${unsigned}.${Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, Buffer.from(unsigned))).toString('base64url')}`;
  };
  const owner = crypto.randomUUID(), issuer = `${project}/auth/v1`, serviceKey = 'local-service-key-fixture';
  const db = createClient(project, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      if (String(url).includes('/.well-known/jwks.json')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
      assert.ok(String(url).includes('/rest/v1/rpc/fixture'));
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${serviceKey}`);
      return new Response('true', { headers: { 'content-type': 'application/json' } });
    } } });
  const verify = token => verifiedUserId(db, new Request(resource, { headers: { authorization: `Bearer ${token}` } }), issuer);
  const claims = claimsFor(owner, { iss: issuer, iat: Math.floor(Date.now() / 1000) });
  assert.equal(await verify(await sign(claims)), owner);
  assert.equal(await verify(await sign({ ...claims, client_id: 'native-oauth' })), null);
  assert.equal(await verify(await sign({ ...claims, aud: 'wrong-api' })), null);
  const valid = await sign(claims), pieces = valid.split('.');
  pieces[1] = Buffer.from(JSON.stringify({ ...claims, sub: crypto.randomUUID() })).toString('base64url');
  assert.equal(await verify(pieces.join('.')), null);
  assert.equal((await db.rpc('fixture')).data, true);
  assert.equal((await db.auth.getSession()).data.session, null);
});

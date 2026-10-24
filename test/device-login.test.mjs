import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler, sha256 } from '../api/handler.mjs';
import { normalizeUserCode } from '../api/device-login.mjs';

/** The real migrations in PGlite, behind a supabase-js-shaped rpc and a token → user map for auth. */
async function server() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb';
    grant usage on schema auth to authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;
    create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(name => name.endsWith('.sql') && !name.includes('dispatch')).sort()) await pg.exec(await readFile(new URL(name, dir), 'utf8'));
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  await pg.query('insert into auth.users values($1,$2),($3,$4)', [owner, 'creator@example.test', other, 'other@example.test']);
  const tokens = { 'fixture-owner-token': owner, 'fixture-other-token': other };
  const rpc = async (name, args) => {
    const keys = Object.keys(args);
    try {
      const result = await pg.query(`select to_jsonb(public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')})) as value`, keys.map(key => args[key]));
      return { data: result.rows[0].value };
    } catch (error) { return { error: { message: error.message } }; }
  };
  const minted = [];
  const creatorLink = async who => { minted.push(who); return { tokenHash: 'a'.repeat(56), expiresAt: '2026-10-24T00:10:00.000Z' }; };
  const db = { rpc, auth: { getUser: async token => tokens[token] ? { data: { user: { id: tokens[token] } } } : { error: new Error('invalid') } } };
  const handle = createHandler({ db, creatorLink });
  const post = (route, body, token) => handle(new Request(`https://test/ai-fighter/${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { pg, owner, other, minted, handle, post };
}

test('start, approve on the homepage, then exactly one magic-link token for the approving user', async () => {
  const { pg, owner, minted, post } = await server();
  const started = await (await post('device-logins')).json();
  assert.equal(started.ok, true);
  assert.match(started.deviceCode, /^afd_[a-f0-9]{64}$/);
  assert.match(started.userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  // Only the secret's hash is stored, never the secret itself.
  const row = (await pg.query('select * from public.af_device_logins')).rows[0];
  assert.equal(row.device_code_hash, await sha256(new TextEncoder().encode(started.deviceCode)));
  assert.ok(!JSON.stringify(row).includes(started.deviceCode));

  const pending = await post('device-logins/token', { deviceCode: started.deviceCode });
  assert.deepEqual([(pending.status), (await pending.json()).status], [200, 'pending']);
  // Approval needs the user's own sign-in; dashes and case in the typed code do not matter.
  assert.equal((await post('device-logins/approve', { userCode: started.userCode })).status, 401);
  const approved = await post('device-logins/approve', { userCode: started.userCode.toLowerCase().replace('-', ' ') }, 'fixture-owner-token');
  assert.equal(approved.status, 200);
  assert.equal(approved.headers.get('access-control-allow-origin'), '*');
  // A second approval of the same code finds nothing open.
  assert.equal((await post('device-logins/approve', { userCode: started.userCode }, 'fixture-other-token')).status, 404);

  await pg.query('update public.af_device_logins set polled_at = now() - interval \'10 seconds\'');
  const granted = await (await post('device-logins/token', { deviceCode: started.deviceCode })).json();
  assert.deepEqual([granted.status, granted.tokenHash], ['approved', 'a'.repeat(56)]);
  assert.deepEqual(minted, [owner]);
  await pg.query('update public.af_device_logins set polled_at = now() - interval \'10 seconds\'');
  const again = await post('device-logins/token', { deviceCode: started.deviceCode });
  assert.deepEqual([again.status, (await again.json()).code], [410, 'device-login-consumed']);
  assert.deepEqual(minted, [owner]);
});

test('polling is paced, codes expire, secrets are validated, and start/poll are not browser routes', async () => {
  const { pg, post, handle } = await server();
  const { deviceCode, userCode } = await (await post('device-logins')).json();
  await post('device-logins/token', { deviceCode });
  const fast = await post('device-logins/token', { deviceCode });
  assert.deepEqual([fast.status, (await fast.json()).code], [429, 'slow-down']);
  await pg.query("update public.af_device_logins set expires_at = now() - interval '1 second', polled_at = null");
  const expired = await post('device-logins/token', { deviceCode });
  assert.deepEqual([expired.status, (await expired.json()).code], [410, 'device-login-expired']);
  assert.equal((await post('device-logins/approve', { userCode }, 'fixture-owner-token')).status, 404);
  for (const body of [{ deviceCode: 'afd_short' }, { deviceCode: `afd_${'0'.repeat(64)}`.toUpperCase() }, {}]) {
    const response = await post('device-logins/token', body);
    assert.ok([400, 404].includes(response.status), JSON.stringify(body));
  }
  assert.equal((await post('device-logins/token', { deviceCode: `afd_${'0'.repeat(64)}` })).status, 404);
  assert.equal((await post('device-logins/approve', { userCode: 'AEIO-UAEI' }, 'fixture-owner-token')).status, 400);
  // Only approve answers browser preflight; start and token stay workspace-only.
  assert.equal((await post('device-logins')).headers.get('access-control-allow-origin'), null);
  assert.equal((await handle(new Request('https://test/ai-fighter/device-logins', { method: 'GET' }))).status, 405);
  // The spec tells clients that this server supports device login.
  const spec = await (await handle(new Request('https://test/ai-fighter/spec'))).json();
  assert.equal(spec.data.registration.deviceLogin, 'v1');
});

test('Postgres caps unauthenticated starts and per-user approvals, and hides the table from clients', async () => {
  const { pg, owner } = await server();
  const hash = n => n.toString(16).padStart(64, '0');
  const start = (n, code) => pg.query('select public.af_device_login_start($1,$2,600)', [hash(n), code]);
  await start(1, 'BCDFGHJK');
  // Two open requests cannot share a pairing code.
  await assert.rejects(start(2, 'BCDFGHJK'), /user-code-collision/);
  // 120 requests created in the last 10 minutes stop further unauthenticated starts.
  await pg.query(`insert into public.af_device_logins(device_code_hash,user_code,status,owner_id,expires_at)
    select lpad(to_hex(g),64,'0'),'ZZZZZZZZ','consumed',$1,now()+interval '10 minutes' from generate_series(1000,1118) g`, [owner]);
  await assert.rejects(start(3, 'CCCCCCCC'), /rate-limit/);
  await pg.query("update public.af_device_logins set created_at = now() - interval '1 hour'");
  await start(3, 'CCCCCCCC');
  // Ten approvals by one user within an hour stop the eleventh.
  await pg.query(`insert into public.af_device_logins(device_code_hash,user_code,status,owner_id,expires_at,approved_at,created_at)
    select lpad(to_hex(g),64,'0'),'XXXXXXXX','approved',$1,now()+interval '10 minutes',now(),now()-interval '1 hour' from generate_series(2000,2009) g`, [owner]);
  await assert.rejects(pg.query('select public.af_device_login_approve($1,$2)', [owner, 'CCCCCCCC']), /rate-limit/);
  await assert.rejects(pg.query('select public.af_device_login_start($1,$2,30)', [hash(4), 'DDDDDDDD']), /invalid-ttl/);
  await pg.query('set role anon');
  await assert.rejects(pg.query('select * from public.af_device_logins'), /permission denied/);
  await assert.rejects(pg.query('select public.af_device_login_poll($1)', [hash(1)]), /permission denied/);
  await pg.query('reset role');
  assert.equal(normalizeUserCode(' bcdf-ghjk '), 'BCDFGHJK');
  assert.equal(normalizeUserCode('BCDF-GHJA'), null);
});

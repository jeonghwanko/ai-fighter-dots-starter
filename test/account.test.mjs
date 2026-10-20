import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../api/handler.mjs';

async function database() {
  const sql = new PGlite();
  await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    grant usage on schema auth to authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) await sql.exec(await readFile(new URL(name, dir), 'utf8'));
  return sql;
}

test('signed-in users without an invitation read their status and leave one rate-limited access request', async () => {
  const sql = await database();
  try {
    const invited = crypto.randomUUID(), guest = crypto.randomUUID(), other = crypto.randomUUID();
    for (const id of [invited, guest, other]) await sql.query('insert into auth.users values($1)', [id]);
    await sql.query('insert into af_creators(owner_id) values($1)', [invited]);
    await sql.exec('set role service_role');
    const tokens = { 'fixture-invited-token': invited, 'fixture-guest-token': guest, 'fixture-other-token': other };
    const calls = [];
    const db = {
      auth: { getUser: async token => token === 'fixture-anon-token' ? { data: { user: { id: guest, is_anonymous: true } } }
        : tokens[token] ? { data: { user: { id: tokens[token] } } } : { error: new Error('invalid') } },
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (!['af_account', 'af_request_access'].includes(name)) return { error: { message: 'unexpected-rpc' } };
        try {
          const query = name === 'af_account' ? 'select af_account($1) as result' : 'select af_request_access($1,$2) as result';
          const values = name === 'af_account' ? [args.p_owner] : [args.p_owner, args.p_note];
          return { data: (await sql.query(query, values)).rows[0].result };
        } catch (error) { return { error: { message: error.message } }; }
      },
    };
    const handle = createHandler({ db });
    const call = (route, token, init = {}) => handle(new Request(`https://test/ai-fighter/${route}`,
      { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }));
    const read = async response => ({ status: response.status, json: await response.json(), cors: response.headers.get('access-control-allow-origin') });
    const post = (token, body) => call('access-requests', token, { method: 'POST', ...(body === undefined ? {} : { body }) });

    // Status needs a verified, non-anonymous user. A user named in the request is ignored.
    assert.equal((await call('me')).status, 401);
    assert.equal((await call('me', 'fixture-anon-token')).status, 401);
    assert.equal((await call('me', 'fixture-unknown-token')).status, 401);
    assert.equal((await read(await call(`me?owner=${invited}`, 'fixture-guest-token'))).json.account.invited, false);

    const me = await read(await call('me', 'fixture-invited-token'));
    assert.equal(me.status, 200); assert.equal(me.cors, '*');
    assert.equal(me.json.account.invited, true); assert.ok(Date.parse(me.json.account.expiresAt) > Date.now());
    assert.equal(me.json.account.request, null);
    assert.deepEqual((await read(await call('me', 'fixture-guest-token'))).json.account, { invited: false, expiresAt: null, request: null });

    // An invited user has nothing to request.
    const already = await read(await post('fixture-invited-token'));
    assert.equal(already.status, 409); assert.equal(already.json.code, 'already-invited');

    const first = await read(await post('fixture-guest-token', JSON.stringify({ note: '  blue cat boxer  ' })));
    assert.equal(first.status, 200); assert.equal(first.json.account.request.status, 'pending');
    assert.equal((await sql.query('select note from af_access_requests where owner_id=$1', [guest])).rows[0].note, 'blue cat boxer');
    assert.equal((await post('fixture-guest-token')).status, 200);
    assert.equal((await post('fixture-guest-token')).status, 200);
    const limited = await read(await post('fixture-guest-token'));
    assert.equal(limited.status, 429); assert.equal(limited.json.code, 'rate-limit');
    assert.equal((await sql.query('select count(*)::int as n from af_access_requests')).rows[0].n, 1);

    // A recent decline stands for 7 days; after that, and after the 24-hour window, the request can be reopened.
    await sql.query(`update af_access_requests set status='declined',request_window=now()-interval '25 hours',updated_at=now() where owner_id=$1`, [guest]);
    const declined = await read(await post('fixture-guest-token'));
    assert.equal(declined.status, 409); assert.equal(declined.json.code, 'request-declined');
    assert.equal((await sql.query('select status from af_access_requests where owner_id=$1', [guest])).rows[0].status, 'declined');
    await sql.query(`update af_access_requests set updated_at=now()-interval '8 days' where owner_id=$1`, [guest]);
    assert.equal((await read(await post('fixture-guest-token'))).json.account.request.status, 'pending');

    // Invalid bodies are rejected before the database.
    const before = calls.length;
    assert.equal((await post('fixture-other-token', '{')).status, 400);
    assert.equal((await post('fixture-other-token', '[]')).status, 400);
    assert.equal((await post('fixture-other-token', JSON.stringify({ note: 7 }))).status, 400);
    assert.equal((await post('fixture-other-token', JSON.stringify({ note: 'x'.repeat(501) }))).status, 422);
    const nul = await read(await post('fixture-other-token', JSON.stringify({ note: 'a\u0000b' })));
    assert.equal(nul.status, 422); assert.equal(nul.json.code, 'invalid-note');
    const tooLong = await read(await post('fixture-other-token', JSON.stringify({ note: 'y'.repeat(501) })));
    assert.equal(tooLong.json.code, 'note-too-long');
    assert.equal((await post('fixture-other-token', 'x'.repeat(4001))).status, 413);
    assert.equal(calls.length, before);

    // Methods, preflight and a missing migration.
    assert.equal((await call('me', 'fixture-guest-token', { method: 'POST' })).status, 405);
    assert.equal((await call('access-requests', 'fixture-guest-token')).status, 405);
    const preflight = await call('access-requests', null, { method: 'OPTIONS' });
    assert.equal(preflight.status, 200); assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
    const missing = createHandler({ db: { ...db, rpc: async () => ({ error: { code: 'PGRST202', message: 'not found' } }) } });
    const notReady = await read(await missing(new Request('https://test/ai-fighter/me', { headers: { authorization: 'Bearer fixture-guest-token' } })));
    assert.equal(notReady.status, 503); assert.equal(notReady.json.code, 'account-not-ready');

    // The submission gate is unchanged: a user who only requested access still gets invite-required.
    const authorize = createHandler({ db: { ...db, rpc: async (name, args) => {
      if (name !== 'af_authorize') return { error: { message: 'unexpected-rpc' } };
      try { await sql.query('select af_authorize($1)', [args.p_owner]); return { data: true }; }
      catch (error) { return { error: { message: error.message } }; }
    } } });
    const submit = await read(await authorize(new Request('https://test/ai-fighter/submissions', { method: 'POST',
      headers: { authorization: 'Bearer fixture-guest-token', 'idempotency-key': crypto.randomUUID() }, body: '{}' })));
    assert.equal(submit.status, 403); assert.equal(submit.json.code, 'invite-required');

    // Clients cannot read the table or call the functions directly.
    await sql.exec('reset role; set role authenticated');
    await assert.rejects(sql.query('select * from af_access_requests'));
    await assert.rejects(sql.query('select af_account($1)', [guest]));
    await assert.rejects(sql.query('select af_request_access($1,$2)', [other, '']));
  } finally { await sql.close(); }
});
